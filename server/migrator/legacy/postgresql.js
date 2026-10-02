/**
 * FROZEN — the pre-Prisma PostgreSQL metadata history: the v20 baseline
 * (postgresql-v20.sql) plus the steps past it, mirroring legacy/sqlite.js. It
 * exists only to bring an install made before Prisma Migrate up to v22, the
 * shape prisma/postgresql/migrations/0_baseline starts from. Never add a step
 * here — new schema changes are Prisma migrations (see server/migrator/index.js).
 */
import fs from 'fs'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { BUILTIN_ROLES } from '../../permissions-catalog.js'
import { LATEST_VERSION } from './sqlite.js'

const POSTGRES_BASELINE_VERSION = 20

// Steps past the v20 baseline, mirroring the SQLite steps of the same version in
// legacy/sqlite.js. Same rules: append-only, additive-only, never edit one
// that shipped. The baseline file stays frozen at v20 so an existing database
// and a fresh one reach the latest version by the same path.
const POSTGRES_STEPS = [
  {
    version: 21,
    up(meta) {
      meta.exec(`
        CREATE TABLE ssh_keys (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          name TEXT NOT NULL,
          algorithm TEXT,
          public_key TEXT NOT NULL,
          fingerprint TEXT,
          credentials TEXT,
          created_by TEXT,
          created_at BIGINT,
          updated_at BIGINT
        );
        CREATE INDEX idx_ssh_keys_workspace ON ssh_keys (workspace_id);
        CREATE TABLE ssh_gateways (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          name TEXT NOT NULL,
          host TEXT NOT NULL,
          port BIGINT,
          username TEXT,
          auth TEXT,
          key_id TEXT,
          host_fingerprint TEXT,
          credentials TEXT,
          created_at BIGINT,
          updated_at BIGINT
        );
        CREATE INDEX idx_ssh_gateways_workspace ON ssh_gateways (workspace_id);
      `)
      const owner = meta.prepare("SELECT id FROM roles WHERE slug = 'owner' AND builtin = 1").get()
      if (owner) meta.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)').run(owner.id, 'ssh.manage')
    },
  },
  {
    version: 22,
    up(meta) {
      meta.exec('ALTER TABLE ssh_gateways ADD COLUMN transport TEXT')
    },
  },
]
const POSTGRES_LATEST_VERSION = POSTGRES_STEPS.at(-1)?.version ?? POSTGRES_BASELINE_VERSION

export function migratePostgres(meta) {
  if (LATEST_VERSION !== POSTGRES_LATEST_VERSION) {
    throw new Error(`PostgreSQL metadata reaches v${POSTGRES_LATEST_VERSION}, but SQLite is v${LATEST_VERSION}; add the PostgreSQL migration before starting`)
  }
  // Every step past `from`, in order, then the stamp. Runs inside the caller's
  // transaction so a failed step leaves the version where it was.
  const upgrade = (from) => {
    const applied = []
    for (const step of POSTGRES_STEPS) {
      if (step.version <= from) continue
      step.up(meta)
      applied.push(step.version)
    }
    if (applied.length) meta.prepare('UPDATE metadata_schema_version SET version = ?').run(POSTGRES_LATEST_VERSION)
    return applied
  }
  return meta.transaction(() => {
    // A transaction-scoped lock serializes first boot across app replicas.
    meta.exec('SELECT pg_advisory_xact_lock(732614083)')
    const versionTable = meta.prepare("SELECT to_regclass('metadata_schema_version') AS name").get().name
    if (!versionTable) {
      const existing = meta.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' LIMIT 1").get()
      if (existing) throw new Error('PostgreSQL metadata schema is not empty; use an empty database or schema')
      const sql = fs.readFileSync(fileURLToPath(new URL('./postgresql-v20.sql', import.meta.url)), 'utf8')
      meta.exec(sql)
      const now = Date.now()
      for (const role of BUILTIN_ROLES) {
        const id = randomUUID()
        meta.prepare('INSERT INTO roles (id, slug, name, description, builtin, applies_to, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)')
          .run(id, role.slug, role.name, role.description, role.appliesTo ? JSON.stringify(role.appliesTo) : null, now, now)
        for (const permission of role.permissions) {
          meta.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)').run(id, permission)
        }
      }
      meta.prepare('INSERT INTO resource_nodes (id, parent_id, kind, type, resource_id, name, owner_id, workspace_id, path, depth, sort, created_at, updated_at) VALUES (?, NULL, ?, ?, NULL, ?, NULL, NULL, ?, 0, 0, ?, ?)')
        .run('root', 'group', 'application', 'Application', '/root', now, now)
      meta.prepare('INSERT INTO metadata_schema_version (version) VALUES (?)').run(POSTGRES_BASELINE_VERSION)
      return { from: 0, applied: [POSTGRES_BASELINE_VERSION, ...upgrade(POSTGRES_BASELINE_VERSION)] }
    }
    const version = meta.prepare('SELECT version FROM metadata_schema_version').get()?.version
    if (!(version >= POSTGRES_BASELINE_VERSION && version <= POSTGRES_LATEST_VERSION)) {
      throw new Error(`PostgreSQL metadata schema version ${version} is unsupported by this app (expected ${POSTGRES_BASELINE_VERSION}–${POSTGRES_LATEST_VERSION})`)
    }
    return { from: version, applied: upgrade(version) }
  })()
}
