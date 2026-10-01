/** Synchronous PostgreSQL metadata adapter for the existing better-sqlite3 call surface. */
import fs from 'fs'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
import { randomUUID } from 'crypto'
import PgNative from 'pg-native'
import pgTypes from 'pg-types'
import { BUILTIN_ROLES } from './permissions-catalog.js'
import { LATEST_VERSION } from './migrations.js'
import { postgresSql } from './postgres-sql.js'

const types = { getTypeParser: (oid, format) => oid === 20 ? Number : pgTypes.getTypeParser(oid, format) }
const POSTGRES_BASELINE_VERSION = 20

// Steps past the v20 baseline, mirroring the SQLite steps of the same version in
// server/migrations.js. Same rules: append-only, additive-only, never edit one
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

export class PostgresMeta {
  constructor(url) {
    this.url = url
    this.client = new PgNative({ types })
    this.client.connectSync(url)
    this.depth = 0
  }

  prepare(sql) {
    const translated = postgresSql(sql)
    const query = (...values) => this.client.querySync(translated, values.length ? values : undefined)
    return {
      get: (...values) => query(...values)[0],
      all: (...values) => query(...values),
      run: (...values) => {
        if (!/^\s*(INSERT|UPDATE|DELETE)\b/i.test(translated)) throw new Error('run() requires a mutation')
        const counted = /\bRETURNING\b/i.test(translated) ? translated : `${translated.trimEnd()} RETURNING 1`
        const rows = this.client.querySync(counted, values.length ? values : undefined)
        return { changes: rows.length }
      },
    }
  }

  exec(sql) { return this.client.querySync(sql) }

  transaction(fn) {
    return (...args) => {
      const depth = this.depth
      const savepoint = `meta_sp_${depth}`
      this.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`)
      this.depth++
      try {
        const value = fn(...args)
        this.exec(depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`)
        return value
      } catch (error) {
        this.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${savepoint}`)
        if (depth !== 0) this.exec(`RELEASE SAVEPOINT ${savepoint}`)
        throw error
      } finally {
        this.depth--
      }
    }
  }

  backup(destPath) {
    const url = new URL(this.url)
    const password = decodeURIComponent(url.password)
    url.password = ''
    const schema = this.prepare('SELECT current_schema() AS name').get().name
    const result = spawnSync('pg_dump', ['--format=custom', '--schema', schema, '--file', destPath, '--dbname', url.toString()], {
      env: { ...process.env, ...(password ? { PGPASSWORD: password } : {}) },
      encoding: 'utf8',
    })
    if (result.error || result.status !== 0) {
      try { fs.unlinkSync(destPath) } catch {}
      throw new Error(result.error?.message || result.stderr?.trim() || 'pg_dump failed')
    }
    return fs.statSync(destPath).size
  }

  close() { this.client.end() }
}

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
      const sql = fs.readFileSync(fileURLToPath(new URL('./postgres-metadata-schema.sql', import.meta.url)), 'utf8')
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
