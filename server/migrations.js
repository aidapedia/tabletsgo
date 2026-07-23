/**
 * Stepped, versioned migrations for the app metadata DB (SQLite).
 *
 * How it works
 *   `PRAGMA user_version` records the last applied step. On boot, migrate()
 *   runs every step with version > user_version, oldest first, each inside its
 *   own transaction, stamping user_version as it goes. Before the first pending
 *   step touches an EXISTING install, the caller-provided snapshot hook copies
 *   the DB file to data/backups/ so a bad upgrade can be rolled back.
 *
 * Rules (see CLAUDE.md "META DB MIGRATIONS")
 *   - APPEND-ONLY: never edit or reorder a shipped step — users' DBs already
 *     ran it. New schema change ⇒ append a new step with the next version.
 *   - ADDITIVE-ONLY: no DROP/RENAME, no NOT NULL column without a default — an
 *     older image must still open a newer DB (the update wizard's rollback
 *     path depends on this).
 *   - From v3 on, steps should be plain DDL/DML (no existence probes) — the
 *     runner guarantees each runs exactly once. Only v1/v2 are idempotent
 *     catch-ups, because the installs they target predate accurate
 *     user_version stamping (every old boot re-stamped user_version = 1).
 */

import { randomUUID } from 'crypto'

// ---- Shared helpers (used by the v1/v2 catch-up steps only) ----

// The full current baseline schema. Fresh installs get this via step v1; old
// installs get any tables they're missing (CREATE TABLE IF NOT EXISTS).
// NOTE: columns introduced after a table shipped live in ensureColumns(), not
// here — editing a CREATE TABLE block only affects brand-new DBs.
function ensureBaseSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT
    );
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      data TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      forward_sql TEXT NOT NULL,   -- JSON array of executed statements
      rollback_sql TEXT,           -- JSON array, same length, null entries where not reversible
      reversible INTEGER NOT NULL, -- 0/1 — false if any statement lacks a rollback
      status TEXT,                 -- 'active' | 'rollbacked' (NULL on legacy rows = active)
      executor_id TEXT,
      executor_name TEXT,
      ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS saved_queries (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sql TEXT NOT NULL,
      kind TEXT,
      ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS saved_folders (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      name TEXT NOT NULL,
      ts INTEGER
    );
    -- Domains: named, colored groupings for a connection's tables. A domain is
    -- an entity (name + color); table_domains maps each table to exactly one
    -- domain (UNIQUE per table), so tables can be grouped by domain.
    CREATE TABLE IF NOT EXISTS domains (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,                  -- hex color string, e.g. '#6366f1'
      ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS table_domains (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      domain_id TEXT NOT NULL,
      ts INTEGER,
      UNIQUE(connection_id, table_name)   -- one domain per table
    );
    CREATE INDEX IF NOT EXISTS idx_table_domains_conn ON table_domains(connection_id);
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      name TEXT NOT NULL,
      graph TEXT,                  -- JSON { nodes, edges }
      ts INTEGER
      -- folder_id (folders.id, NULL = root) is added by migration v4 via ALTER;
      -- like dashboards.folder_id, it is intentionally NOT inlined here so v4's
      -- plain ALTER doesn't collide on fresh installs (which also run v4).
    );
    CREATE TABLE IF NOT EXISTS dashboards (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT,                 -- JSON { variables, widgets }
      ts INTEGER
      -- folder_id (folders.id, NULL = root) is added by migration v3 via ALTER;
      -- it is intentionally NOT inlined here so v3's plain ALTER doesn't collide
      -- on fresh installs (which also run v3).
    );
    -- Generic, polymorphic folders: one tree per (connection, type). The type
    -- discriminates what the folder groups ('query' | 'dashboard' | future);
    -- items point back via their own folder_id (saved_queries, dashboards, …).
    -- parent_id builds the tree (NULL = root); nesting caps are per-type and
    -- enforced in server.js. Supersedes the legacy saved_folders table, whose
    -- rows migration v3 copies in as type='query'. CREATE ... IF NOT EXISTS is
    -- idempotent with v3, so fresh + existing installs agree.
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      type TEXT NOT NULL,          -- 'query' | 'dashboard' | future
      name TEXT NOT NULL,
      parent_id TEXT,
      ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS storage_destinations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      endpoint TEXT,              -- custom endpoint (MinIO/R2/B2/…); null = AWS default
      region TEXT,
      bucket TEXT NOT NULL,
      path_prefix TEXT,
      force_path_style INTEGER,   -- 0/1 — required by most non-AWS S3-compatible services
      credentials TEXT,           -- AES-256-GCM: JSON {accessKeyId, secretAccessKey, sessionToken?}
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,  -- denormalized for the calendar aggregate query
      trigger_kind TEXT NOT NULL,   -- 'manual' | 'schedule'
      status TEXT NOT NULL,         -- 'success' | 'failed'
      log TEXT,                     -- JSON: the per-node log[] runWorkflow() produces
      error TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_conn_day ON workflow_runs(connection_id, started_at);
    CREATE TABLE IF NOT EXISTS backup_schedules (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL UNIQUE,
      frequency TEXT NOT NULL,        -- 'hourly' | 'daily'
      hour_of_day INTEGER,
      destination_ids TEXT,           -- JSON array
      retry_limit INTEGER DEFAULT 0,
      retry_delay_sec INTEGER DEFAULT 60,
      retention_days INTEGER DEFAULT 0,
      encrypt INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      next_run_at INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS backup_runs (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      schedule_id TEXT NOT NULL,
      trigger_kind TEXT NOT NULL,     -- 'manual' | 'schedule' | 'retry'
      status TEXT NOT NULL,           -- 'success' | 'failed'
      error TEXT,
      uploads TEXT,                   -- JSON: [{destinationId, ok, key?, sizeBytes?, encrypted?, error?, prunedCount?, deleted?}]
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_backup_runs_conn_day ON backup_runs(connection_id, started_at);
    CREATE TABLE IF NOT EXISTS query_history (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      table_name TEXT,
      query TEXT NOT NULL,
      status TEXT NOT NULL,        -- 'success' | 'failed'
      latency INTEGER,             -- execution latency in ms
      error TEXT,
      executor_id TEXT,
      executor_name TEXT,
      ts INTEGER                   -- execution time (epoch ms)
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      settings TEXT,               -- JSON: { smtp: {...} }
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,          -- 'admin' | 'member'
      created_at INTEGER,
      UNIQUE(workspace_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER,
      UNIQUE(team_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
    -- Generic principal assignment for a connection. Empty set = open to all
    -- workspace members (backward compatible); any row restricts access to the
    -- listed teams' members + listed users (+ workspace admins, always).
    CREATE TABLE IF NOT EXISTS connection_access (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,   -- 'team' | 'user'
      principal_id TEXT NOT NULL,
      created_at INTEGER,
      UNIQUE(connection_id, principal_type, principal_id)
    );
    CREATE INDEX IF NOT EXISTS idx_connection_access_conn ON connection_access(connection_id);
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER
    );
  `)
}

// Probe-then-ALTER for columns added after a table first shipped. Idempotent —
// needed by the catch-up steps because pre-v2 installs may or may not already
// have any given column (old code re-ran these on every boot).
function addColumn(db, table, col) {
  const name = col.split(' ')[0]
  try {
    db.prepare(`SELECT ${name} FROM ${table} LIMIT 1`).get()
  } catch {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`)
  }
}

function ensureColumns(db) {
  addColumn(db, 'saved_queries', 'kind TEXT')
  addColumn(db, 'saved_queries', 'folder_id TEXT')
  // Folders can nest: parent_id points at another saved_folders row (NULL = root).
  addColumn(db, 'saved_folders', 'parent_id TEXT')
  // Invited members: username holds the email, password blank until accepted.
  addColumn(db, 'users', 'status TEXT') // 'active' | 'pending'
  addColumn(db, 'users', 'invite_token TEXT')
  addColumn(db, 'users', 'invite_workspace TEXT')
  addColumn(db, 'users', 'token_expires INTEGER')
  // Password reset (separate from invite tokens so the two never collide).
  addColumn(db, 'users', 'reset_token TEXT')
  addColumn(db, 'users', 'reset_expires INTEGER')
  db.exec(`UPDATE users SET status = 'active' WHERE status IS NULL`)
  // Connections: split the old opaque `data` blob into plain generic columns +
  // an encrypted `credentials` blob (see encryptLegacyCredentials).
  addColumn(db, 'connections', 'type TEXT')
  addColumn(db, 'connections', 'name TEXT')
  addColumn(db, 'connections', 'workspace_id TEXT')
  addColumn(db, 'connections', 'environment TEXT')
  addColumn(db, 'connections', 'folder TEXT')
  addColumn(db, 'connections', 'tags TEXT')
  addColumn(db, 'connections', 'credentials TEXT')
  addColumn(db, 'connections', 'schema_version INTEGER')
  addColumn(db, 'connections', 'updated_at INTEGER')
  // Owner = the user who created the connection (defaults on create).
  addColumn(db, 'connections', 'owner_id TEXT')
  // Schema migrations: status tracks whether a version is still applied
  // ('active') or has been undone via rollback ('rollbacked'). Old rows predate
  // this column — treat NULL as active.
  addColumn(db, 'schema_migrations', 'status TEXT')
  db.exec(`UPDATE schema_migrations SET status = 'active' WHERE status IS NULL`)
  // Workflows: protected = undeletable (e.g. the auto-created backup workflow);
  // schedule_enabled/next_run_at drive the cron scheduler (see runDueWorkflows).
  addColumn(db, 'workflows', 'protected INTEGER DEFAULT 0')
  addColumn(db, 'workflows', 'schedule_enabled INTEGER DEFAULT 0')
  addColumn(db, 'workflows', 'next_run_at INTEGER')
}

// Pre-workspace installs: create a Default workspace, enroll existing users,
// and attach existing (still-legacy-format) connections to it. Guarded — a
// no-op on fresh DBs and on installs that already have a workspace.
function migrateToWorkspaces(db) {
  const hasUsers = !!db.prepare('SELECT 1 FROM users LIMIT 1').get()
  if (!hasUsers || db.prepare('SELECT 1 FROM workspaces LIMIT 1').get()) return
  const wid = randomUUID()
  const now = Date.now()
  db.prepare('INSERT INTO workspaces (id, name, settings, created_at) VALUES (?, ?, ?, ?)').run(wid, 'Default Workspace', '{}', now)
  db.prepare('SELECT id, role FROM users')
    .all()
    .forEach((u, i) => {
      db.prepare('INSERT OR IGNORE INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)').run(
        randomUUID(),
        wid,
        u.id,
        u.role === 'admin' || i === 0 ? 'admin' : 'member',
        now
      )
    })
  for (const row of db.prepare('SELECT id, data FROM connections WHERE data IS NOT NULL').all()) {
    let data
    try {
      data = JSON.parse(row.data)
    } catch {
      continue
    }
    if (!data.workspaceId) {
      data.workspaceId = wid
      db.prepare('UPDATE connections SET data = ? WHERE id = ?').run(JSON.stringify(data), row.id)
    }
  }
  console.log('🔁 Migrated existing users/connections into Default Workspace')
}

// Backfill legacy connections (still holding everything in the opaque `data`
// blob) into the new columns: generic fields as plain columns, the rest
// (host/port/username/password/…) encrypted into `credentials`. Guarded by
// `type IS NULL` — a no-op once every row is migrated.
function encryptLegacyCredentials(db, ctx) {
  const legacyRows = db.prepare('SELECT id, data, created_at FROM connections WHERE type IS NULL AND data IS NOT NULL').all()
  if (!legacyRows.length) return
  if (typeof ctx.encryptSecret !== 'function') {
    throw new Error('migrations: encryptSecret hook is required to migrate legacy connection credentials')
  }
  for (const row of legacyRows) {
    let data
    try {
      data = JSON.parse(row.data)
    } catch {
      continue
    }
    const { id, name, type, workspaceId, environment, folder, tags, ...credentials } = data
    db.prepare(
      // `data` still has a NOT NULL constraint on installs predating this
      // migration (it was created with `data TEXT NOT NULL`) — clear its
      // plaintext contents with a harmless placeholder rather than NULL.
      `UPDATE connections SET type = ?, name = ?, workspace_id = ?, environment = ?, folder = ?, tags = ?, credentials = ?, schema_version = ?, updated_at = ?, data = '{}' WHERE id = ?`
    ).run(
      type || null,
      name || null,
      workspaceId || null,
      environment || null,
      folder || null,
      JSON.stringify(tags || []),
      ctx.encryptSecret(JSON.stringify(credentials)),
      1,
      row.created_at || Date.now(),
      row.id
    )
  }
  console.log(`🔐 Migrated ${legacyRows.length} connection(s) to encrypted credential storage`)
}

// ---- The migration steps (append-only; never edit a shipped step) ----

export const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline schema, Default Workspace, encrypted credentials',
    up(db, ctx) {
      ensureBaseSchema(db)
      ensureColumns(db)
      migrateToWorkspaces(db)
      encryptLegacyCredentials(db, ctx)
    },
  },
  {
    version: 2,
    name: 'catch-up for installs stamped v1 while the schema kept evolving',
    // Old code re-stamped user_version = 1 on every boot without tracking which
    // tables/columns had actually been added, so a v1 install can be missing
    // anything added since (owner_id, workflow scheduling columns, dashboards,
    // backup tables, …). Re-run the idempotent sync once to true everything up;
    // from here on user_version is accurate and steps can be plain DDL.
    up(db) {
      ensureBaseSchema(db)
      ensureColumns(db)
    },
  },
  {
    version: 3,
    name: 'unified polymorphic folders (folders + dashboards.folder_id; backfill saved_folders)',
    up(db) {
      // Generic folders tree shared by every folderable resource, keyed by type.
      db.exec(`
        CREATE TABLE IF NOT EXISTS folders (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          parent_id TEXT,
          ts INTEGER
        );
      `)
      // Fold the legacy saved-query folders in as type='query'. Ids are
      // preserved, so saved_queries.folder_id keeps resolving without a repoint.
      // OR IGNORE keeps this safe if a partial run ever left rows behind. The
      // old saved_folders table is left in place (additive-only / rollback).
      db.exec(`
        INSERT OR IGNORE INTO folders (id, connection_id, type, name, parent_id, ts)
        SELECT id, connection_id, 'query', name, parent_id, ts FROM saved_folders
      `)
      // Dashboards can now live in a folder too.
      db.exec(`ALTER TABLE dashboards ADD COLUMN folder_id TEXT`)
    },
  },
  {
    version: 4,
    name: 'workflows.folder_id (workflows become folderable, type=workflow)',
    up(db) {
      // Workflows can now live in a folder, grouped by the generic folders tree
      // under type='workflow' (see FOLDER_TYPES in server.js). Runs on both fresh
      // and existing installs, so folder_id is not inlined in the baseline.
      db.exec(`ALTER TABLE workflows ADD COLUMN folder_id TEXT`)
    },
  },
  // v5+: append plain, run-exactly-once steps here, e.g.
  // {
  //   version: 5,
  //   name: 'connections: last_used_at',
  //   up(db) {
  //     db.exec(`ALTER TABLE connections ADD COLUMN last_used_at INTEGER`)
  //   },
  // },
]

// Tables kept only so an older image can still open a newer DB (rollback
// compat) — the live code must never read or write them. Add an entry here
// whenever a step supersedes a table instead of dropping it; this is the
// shopping list for an eventual cleanup step once the release floor has
// moved past every image that still used the table.
export const DEPRECATED_TABLES = [
  { table: 'saved_folders', supersededBy: 'folders', sinceStep: 3 },
]

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

/**
 * Run all pending migration steps on `db`.
 *
 * ctx.snapshot(fromVersion) — called once, before the first pending step, but
 *   only when the DB already has data (existing install). Should copy the DB
 *   file somewhere safe; failures there must not block the migration.
 * ctx.encryptSecret(plaintext) — AES encryptor for the v1 credentials backfill.
 *
 * Returns { from, applied: [versions…] }.
 */
export function migrate(db, ctx = {}) {
  const latest = MIGRATIONS[MIGRATIONS.length - 1].version
  const from = db.pragma('user_version', { simple: true })
  if (from >= latest) return { from, applied: [] }

  // "Existing install" = has a users table. Fresh DBs skip the snapshot (there
  // is nothing to protect yet).
  const hadSchema = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()
  if (hadSchema && typeof ctx.snapshot === 'function') ctx.snapshot(from)

  const applied = []
  for (const m of MIGRATIONS) {
    if (m.version <= from) continue
    db.transaction(() => {
      m.up(db, ctx)
      db.pragma(`user_version = ${m.version}`)
    })()
    applied.push(m.version)
    console.log(`⬆️  Meta migration v${m.version}: ${m.name}`)
  }
  return { from, applied }
}
