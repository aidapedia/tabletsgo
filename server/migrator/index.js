/**
 * The metadata migrator — brings the app's own database to the latest schema.
 *
 * The app runs it on boot (server/migrator/boot.js, the first import of
 * server.js), before server/meta.js opens its connection. `npm run migrate`
 * runs the same thing by hand, and the in-app updater runs it in a one-shot
 * container ahead of the swap so a failure can restart the old image. On SQLite
 * nothing else may hold the file open — Prisma Migrate cannot work on a file
 * another connection holds — which is why every phase here opens its own handle
 * and closes it before Prisma runs.
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
import { BACKUPS_DIR, META_DB_TYPE, ROOT_DIR } from '../config.js'
import { APP_SETTINGS_KEY, encryptSecret } from '../crypto.js'
import { openMeta, snapshotMeta } from '../meta-connection.js'
import { exportHayatBundle } from './hayat-export.js'
import { LATEST_VERSION as LEGACY_VERSION, migrate as migrateLegacySqlite } from './legacy/sqlite.js'
import { migratePostgres as migrateLegacyPostgres } from './legacy/postgresql.js'

const BASELINE = '0_baseline'
// The migration that drops tabletsgo's own identity tables once Hayat owns them.
export const HAYAT_DROP = '20261110000000_hayat_owns_identity'
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

// What a database needs beyond its tables: the legacy marker, stamped so an
// image from before Prisma that opens this database sees it already at v22
// instead of replaying v1 over it. (Roles and the resource tree used to be
// seeded here too; Hayat owns both now.)
function seed(db) {
  db.transaction(() => {
    if (isPostgres) {
      if (!db.prepare('SELECT 1 FROM metadata_schema_version').get()) {
        db.prepare('INSERT INTO metadata_schema_version (version) VALUES (?)').run(LEGACY_VERSION)
      }
    } else if (db.pragma('user_version', { simple: true }) < LEGACY_VERSION) {
      db.pragma(`user_version = ${LEGACY_VERSION}`)
    }
  })()
}

/**
 * Before the drop: write everything the identity tables hold to
 * data/hayat-import-<time>.json, the bundle `hayat import` loads. Refuses to let
 * the drop run if it can't — those rows exist nowhere else (the pre-migrate
 * snapshot aside). An install with no accounts has nothing to carry over.
 */
export function writeHayatBundle(db, log, dir = path.dirname(BACKUPS_DIR)) {
  if (!hasTable(db, 'users') || !db.prepare('SELECT COUNT(*) AS c FROM users').get().c) return null
  const bundle = exportHayatBundle(db, (name) => hasTable(db, name))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `hayat-import-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify(bundle, null, 2), { mode: 0o600 })
  log(`🪪 Accounts and access moved out for Hayat: ${file} (${bundle.users.length} people, ${bundle.tenants.length} workspaces).`)
  log('   Load it with `hayat import --file <that file> --app-url <this instance>` — see README → Hayat.')
  for (const s of bundle.skipped) log(`   not carried over: ${s}`)
  return file
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

  if (metaSchemaStatus().pending.includes(HAYAT_DROP)) withMeta((db) => writeHayatBundle(db, log))
  log(prisma('migrate', 'deploy'))
  withMeta(seed)

  const done = new Set(before.applied)
  return { state: before.state, applied: metaSchemaStatus().applied.filter((name) => !done.has(name)) }
}
