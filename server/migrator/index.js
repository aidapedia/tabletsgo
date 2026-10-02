/**
 * The metadata migrator — brings the app's own database to the latest schema.
 *
 * It runs as its own process before the app starts: `npm run migrate`, the
 * compose `migrate` service, or the one-shot container the in-app updater runs
 * ahead of the swap. The app never migrates; it calls assertMetaSchemaCurrent()
 * on boot and refuses to start on a stale schema. On SQLite it must also run
 * while the app is stopped — Prisma Migrate cannot work on a file another
 * connection holds open, which is why every phase here opens its own handle and
 * closes it before Prisma runs.
 *
 * Prisma Migrate owns the history (prisma/<engine>/migrations, one folder per
 * engine because a Prisma history is locked to one provider). A database is in
 * one of three states:
 *   - empty   → `prisma migrate deploy` builds it from 0_baseline, then seed().
 *   - legacy  → made before Prisma: the frozen legacy steps bring it to v22,
 *               then 0_baseline is *recorded* as applied (it is v22, so running
 *               it would collide with the tables already there), then deploy.
 *   - prisma  → deploy whatever is pending.
 * An existing database is snapshotted to data/backups/ before anything changes.
 */
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { randomUUID } from 'crypto'
import { BACKUPS_DIR, META_DB_TYPE, ROOT_DIR } from '../config.js'
import { APP_SETTINGS_KEY, encryptSecret } from '../crypto.js'
import { openMeta, snapshotMeta } from '../meta-connection.js'
import { BUILTIN_ROLES } from '../permissions-catalog.js'
import { LATEST_VERSION as LEGACY_VERSION, migrate as migrateLegacySqlite } from './legacy/sqlite.js'
import { migratePostgres as migrateLegacyPostgres } from './legacy/postgresql.js'

const BASELINE = '0_baseline'
const MIGRATIONS_DIR = path.join(ROOT_DIR, 'prisma', META_DB_TYPE, 'migrations')
const PRISMA_CLI = path.join(ROOT_DIR, 'node_modules', 'prisma', 'build', 'index.js')
const PRISMA_CONFIG = path.join(ROOT_DIR, 'prisma.config.mjs')
const isPostgres = META_DB_TYPE === 'postgresql'

function withMeta(fn) {
  const db = openMeta()
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

function hasTable(db, name) {
  return isPostgres
    ? !!db.prepare('SELECT to_regclass(?) AS name').get(name).name
    : !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
}

function legacyVersion(db) {
  return isPostgres
    ? db.prepare('SELECT version FROM metadata_schema_version').get()?.version ?? 0
    : db.pragma('user_version', { simple: true })
}

// Prisma applies migration folders in name order.
function migrationNames() {
  return fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

export function metaSchemaStatus() {
  return withMeta((db) => {
    const tracked = hasTable(db, '_prisma_migrations')
    const state = tracked ? 'prisma' : hasTable(db, 'users') ? 'legacy' : 'empty'
    const applied = tracked
      ? db.prepare('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')
        .all().map((row) => row.migration_name)
      : []
    const done = new Set(applied)
    return { engine: META_DB_TYPE, state, applied, pending: migrationNames().filter((name) => !done.has(name)) }
  })
}

export function assertMetaSchemaCurrent() {
  const { pending } = metaSchemaStatus()
  if (pending.length) {
    throw new Error(`The metadata schema is not up to date (pending: ${pending.join(', ')}). Run \`npm run migrate\` — or the compose \`migrate\` service — before starting the app.`)
  }
}

function prisma(...args) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args, '--config', PRISMA_CONFIG], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    // Prisma phones home for update notices; a migration run has no use for it.
    env: { ...process.env, CHECKPOINT_DISABLE: '1' },
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
  if (result.status !== 0) throw new Error(`prisma ${args.join(' ')} failed:\n${output || result.error?.message}`)
  return output
}

function snapshot(db, label, log) {
  try {
    const dest = path.join(BACKUPS_DIR, `pre-migrate-${label}-${Date.now()}.db`)
    const size = snapshotMeta(db, dest)
    log(`🛟 Pre-migration meta snapshot: ${dest} (${size} bytes)`)
  } catch (e) {
    // Never blocks the upgrade — same trade the legacy runner made.
    log(`⚠️  Pre-migration snapshot failed: ${e.message}`)
  }
}

function upgradeLegacy(db) {
  if (isPostgres) return migrateLegacyPostgres(db)
  return migrateLegacySqlite(db, {
    encryptSecret,
    // v10 promotes a workspace's plaintext SMTP password into app_settings.
    encryptAppSetting: (plaintext) => encryptSecret(plaintext, APP_SETTINGS_KEY),
  })
}

// What a database needs beyond its tables: the built-in roles and the root of
// the resource tree. Insert-if-missing, so a run that died between deploy and
// seed finishes the job next time, and an upgraded install (which the legacy
// steps already seeded) is left as it is.
function seed(db) {
  db.transaction(() => {
    const now = Date.now()
    if (!db.prepare('SELECT 1 FROM roles WHERE builtin = 1 LIMIT 1').get()) {
      const insRole = db.prepare('INSERT INTO roles (id, slug, name, description, builtin, applies_to, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)')
      const insGrant = db.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)')
      for (const role of BUILTIN_ROLES) {
        const id = randomUUID()
        insRole.run(id, role.slug, role.name, role.description, role.appliesTo ? JSON.stringify(role.appliesTo) : null, now, now)
        for (const permission of role.permissions) insGrant.run(id, permission)
      }
    }
    db.prepare(`INSERT OR IGNORE INTO resource_nodes (id, parent_id, kind, type, resource_id, name, owner_id, workspace_id, path, depth, sort, created_at, updated_at)
      VALUES ('root', NULL, 'group', 'application', NULL, 'Application', NULL, NULL, '/root', 0, 0, ?, ?)`).run(now, now)

    // Stamp the legacy marker too, so an image from before Prisma that opens
    // this database sees it already at v22 instead of replaying v1 over it.
    if (isPostgres) {
      if (!db.prepare('SELECT 1 FROM metadata_schema_version').get()) {
        db.prepare('INSERT INTO metadata_schema_version (version) VALUES (?)').run(LEGACY_VERSION)
      }
    } else if (db.pragma('user_version', { simple: true }) < LEGACY_VERSION) {
      db.pragma(`user_version = ${LEGACY_VERSION}`)
    }
  })()
}

/** Bring the metadata database to the latest schema. Returns what it did. */
export function runMigrations({ log = console.log } = {}) {
  const before = metaSchemaStatus()
  if (before.state === 'prisma' && !before.pending.length) {
    log(`✅ Metadata schema (${META_DB_TYPE}) is up to date — ${before.applied.at(-1)}`)
    return { state: before.state, applied: [] }
  }

  if (before.state === 'legacy') {
    withMeta((db) => {
      const from = legacyVersion(db)
      snapshot(db, `v${from}`, log)
      upgradeLegacy(db)
      log(`⬆️  Legacy steps: v${from} → v${LEGACY_VERSION}`)
    })
    prisma('migrate', 'resolve', '--applied', BASELINE)
    log(`📌 Recorded ${BASELINE} as applied (legacy v${LEGACY_VERSION})`)
  } else if (before.state === 'prisma') {
    withMeta((db) => snapshot(db, before.applied.at(-1), log))
  }

  log(prisma('migrate', 'deploy'))
  withMeta(seed)

  const done = new Set(before.applied)
  return { state: before.state, applied: metaSchemaStatus().applied.filter((name) => !done.has(name)) }
}
