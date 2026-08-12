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
import { BUILTIN_ROLES } from './permissions-catalog.js'

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
      role TEXT                    -- 'admin' (instance admin) | 'user'
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
    -- Per-table metadata: one row per (connection, table_name). Tables live in
    -- the user's database, not here, so this is where anything the app knows
    -- about a table hangs. Today that's folder membership (folders.id,
    -- type='table') — it doubles as the "item table" the generic folders tree
    -- needs; future per-table config (access, display, …) becomes new columns.
    -- Superseded the domains/table_domains pair in migration v5;
    -- CREATE ... IF NOT EXISTS is idempotent with v5, so fresh + existing
    -- installs agree.
    CREATE TABLE IF NOT EXISTS connection_tables (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      folder_id TEXT,                     -- folders.id (type='table'), NULL = ungrouped
      ts INTEGER,
      UNIQUE(connection_id, table_name)   -- one row (so one folder) per table
    );
    CREATE INDEX IF NOT EXISTS idx_connection_tables_conn ON connection_tables(connection_id);
    -- DEPRECATED (superseded by folders type='table' + connection_tables in v5).
    -- Kept for rollback compat only — live code must not read these.
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
    -- A schema drafted from scratch: a diagram that belongs to a workspace
    -- rather than to a connection, so there is no database behind it and
    -- nothing to commit -- db_type is the dialect its DDL is written for.
    -- Drafts designed *against* a connection stay in saved_queries (kind =
    -- 'schema'); this table is only the connection-less kind.
    CREATE TABLE IF NOT EXISTS schema_drafts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      db_type TEXT NOT NULL,       -- 'sqlite' | 'postgresql' | … (a connection type)
      sql TEXT,                    -- staged DDL, statements joined by ';'
      created_by TEXT,             -- users.id of whoever started it
      ts INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_schema_drafts_workspace ON schema_drafts (workspace_id);
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
    -- discriminates what the folder groups ('query' | 'dashboard' | 'workflow' |
    -- 'table'); items point back via their own folder_id (saved_queries,
    -- dashboards, workflows, connection_tables).
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
      -- include_config (0/1 — also upload the connection export JSON) is added
      -- by migration v6 via ALTER; like dashboards.folder_id it is intentionally
      -- NOT inlined here so v6's plain ALTER doesn't collide on fresh installs.
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
      role TEXT NOT NULL,          -- 'owner' | 'member' (legacy 'admin' reads as 'owner')
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
    -- The durable login store: one row per bearer token, read through a cache
    -- (memory, or Redis when SESSION_REDIS_URL is set). See server/sessions/.
    -- The ns column keeps the store contract generic; only 'auth' is stored
    -- durably — connection sessions describe live sockets and are cache-only.
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER
      -- ns / context / expires_at (and their indexes) are added by migration v8
      -- via ALTER; like dashboards.folder_id above, they are intentionally NOT
      -- inlined here so v8's plain ALTER doesn't collide on fresh installs
      -- (which also run v8).
    );
    -- Instance-wide settings an admin edits from the admin area — the
    -- instance-level counterpart of workspaces.settings. Deliberately a
    -- key/value store (value is JSON) so a future instance-wide setting is a
    -- new key, not a new table. Today: 'smtp' (see server/app-settings.js).
    -- CREATE ... IF NOT EXISTS is idempotent with v9, so fresh + existing
    -- installs agree.
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,                  -- JSON; secrets inside it are AES-256-GCM sealed
      updated_at INTEGER
    );
    -- Workspace roles an instance admin defines (server/permissions.js). The
    -- slug is what workspace_members.role stores, so it is fixed at creation;
    -- 'owner' and 'member' are seeded builtins whose slugs match the literals
    -- that column held before roles became configurable.
    -- CREATE ... IF NOT EXISTS is idempotent with v12, so fresh + existing
    -- installs agree (same arrangement as app_settings/v9 above).
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,   -- stored in workspace_members.role
      name TEXT NOT NULL,
      description TEXT,
      builtin INTEGER DEFAULT 0,   -- 1 = seeded, can be edited but never deleted
      created_at INTEGER,
      updated_at INTEGER
    );
    -- What a role grants. Rows are permission KEYS from the catalog in
    -- server/permissions-catalog.js; a key this image doesn't know is ignored
    -- on read, which is what lets an older image open a newer DB.
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      UNIQUE(role_id, permission)
    );
    CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
  `)
}

/**
 * Insert the built-in roles if they're missing. Shared by the baseline and step
 * v12 so fresh and existing installs land in the same place, and idempotent: a
 * builtin an admin has since edited is left exactly as they left it.
 */
function seedBuiltinRoles(db) {
  const now = Date.now()
  const insRole = db.prepare('INSERT INTO roles (id, slug, name, description, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
  const insGrant = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)')
  for (const role of BUILTIN_ROLES) {
    if (db.prepare('SELECT 1 FROM roles WHERE slug = ?').get(role.slug)) continue
    const id = randomUUID()
    insRole.run(id, role.slug, role.name, role.description, now, now)
    for (const permission of role.permissions) insGrant.run(id, permission)
  }
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
  // max_sessions (concurrent session cap) is added by migration v7 via ALTER —
  // like backup_schedules.include_config it is intentionally NOT added here, so
  // v7's plain ALTER doesn't collide on a fresh install.
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
  {
    version: 5,
    name: 'domains become table folders (folders.color + connection_tables; backfill domains)',
    up(db) {
      // Folders carry a color now — it came over with the domains they absorb,
      // and every folder type can use it. NULL = no color (the default look).
      db.exec(`ALTER TABLE folders ADD COLUMN color TEXT`)
      // Tables live in the user's database, not here, so anything the app knows
      // about one needs a row of its own. Folder membership is the first such
      // fact (this is the "item table" for type='table' folders); later
      // per-table config lands here as extra columns.
      db.exec(`
        CREATE TABLE IF NOT EXISTS connection_tables (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          table_name TEXT NOT NULL,
          folder_id TEXT,
          ts INTEGER,
          UNIQUE(connection_id, table_name)
        );
      `)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_connection_tables_conn ON connection_tables(connection_id)`)
      // Each domain becomes a root-level folder of type='table', keeping its id
      // (so table_domains.domain_id maps straight across), name and color.
      db.exec(`
        INSERT OR IGNORE INTO folders (id, connection_id, type, name, color, parent_id, ts)
        SELECT id, connection_id, 'table', name, color, NULL, ts FROM domains
      `)
      db.exec(`
        INSERT OR IGNORE INTO connection_tables (id, connection_id, table_name, folder_id, ts)
        SELECT id, connection_id, table_name, domain_id, ts FROM table_domains
      `)
    },
  },
  {
    version: 6,
    name: 'backup_schedules.include_config (ship the connection JSON with each run)',
    up(db) {
      // Opt-in: a scheduled run also uploads the connection's export document
      // (settings + folders + saved queries + workflows + dashboards + the
      // schedule itself) next to the database dump. Default 0 — existing
      // schedules keep backing up data only until someone turns it on.
      db.exec(`ALTER TABLE backup_schedules ADD COLUMN include_config INTEGER DEFAULT 0`)
    },
  },
  {
    version: 7,
    name: 'connections.max_sessions (per-connection concurrent session cap)',
    up(db) {
      // 0/NULL = inherit: the workspace default, then MAX_SESSIONS_PER_CONNECTION,
      // then unlimited. Existing connections keep today's behaviour (no cap).
      db.exec(`ALTER TABLE connections ADD COLUMN max_sessions INTEGER DEFAULT 0`)
    },
  },
  {
    version: 8,
    name: 'two-tier roles + sessions become the durable login store',
    up(db) {
      // ---- Part 1: roles ----
      // Roles split into two independent dimensions (see CLAUDE.md "AUTH MODEL"):
      //   users.role            'admin' = instance admin | 'user' = everyone else
      //   workspace_members.role 'owner' | 'member'
      // Both columns already exist; this step only normalizes their values.

      // 1. Workspace 'admin' becomes 'owner'. (memberRole() also normalizes on
      //    read, so a rolled-back-then-forward DB never sees a mixed vocabulary.)
      db.prepare("UPDATE workspace_members SET role = 'owner' WHERE role = 'admin'").run()

      // 2. Every non-admin account gets the explicit 'user' role (it was NULL for
      //    invited members, which read as "no role" rather than "regular user").
      db.prepare("UPDATE users SET role = 'user' WHERE role IS NULL OR role <> 'admin'").run()

      // 3. An instance admin may not own or belong to a workspace — the whole
      //    point of the split is that instance administration carries no data
      //    access. Hand each workspace they owned to its longest-standing
      //    remaining member (promoted if needed) so nothing is left ownerless,
      //    then drop the admin's membership + team rows.
      const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all()
      for (const admin of admins) {
        const owned = db.prepare('SELECT workspace_id FROM workspace_members WHERE user_id = ?').all(admin.id)
        for (const { workspace_id: wid } of owned) {
          db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').run(wid, admin.id)
          db.prepare(
            `DELETE FROM team_members WHERE user_id = ?
               AND team_id IN (SELECT id FROM teams WHERE workspace_id = ?)`
          ).run(admin.id, wid)
          const owners = db.prepare("SELECT COUNT(*) c FROM workspace_members WHERE workspace_id = ? AND role = 'owner'").get(wid).c
          if (owners > 0) continue
          // No owner left — promote the oldest remaining member. A workspace with
          // no members at all stays ownerless; an instance admin assigns one from
          // the admin area.
          const heir = db
            .prepare('SELECT user_id FROM workspace_members WHERE workspace_id = ? ORDER BY created_at LIMIT 1')
            .get(wid)
          if (heir) db.prepare("UPDATE workspace_members SET role = 'owner' WHERE workspace_id = ? AND user_id = ?").run(wid, heir.user_id)
        }
      }

      // ---- Part 2: the sessions table ----
      // Step 7 moved logins into the session store and left this table behind
      // for rollback only. It comes back as the *source of truth*: the store
      // now reads through a cache (memory, or Redis when SESSION_REDIS_URL is
      // set) to these rows, so a login survives a restart or a flushed cache.
      // See server/sessions/{db,hybrid}.js.
      //
      // The table may hold pre-v7 rows; the three columns below are additive
      // and the backfill gives those rows a namespace and an expiry rather
      // than leaving them to be read as already-expired.
      db.exec(`ALTER TABLE sessions ADD COLUMN ns TEXT`)
      db.exec(`ALTER TABLE sessions ADD COLUMN context TEXT`)
      db.exec(`ALTER TABLE sessions ADD COLUMN expires_at INTEGER`)
      db.prepare(
        `UPDATE sessions
            SET ns = 'auth',
                context = COALESCE(context, json_object('userId', user_id, 'createdAt', COALESCE(created_at, ?))),
                expires_at = COALESCE(created_at, ?) + ?`
      ).run(Date.now(), Date.now(), 30 * 24 * 60 * 60 * 1000)
      // list/count/sweep filter on (ns, expires_at); signing a user out
      // everywhere filters on user_id. Both run on the authenticated path.
      db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_ns_expires ON sessions(ns, expires_at)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`)
    },
  },
  {
    version: 9,
    name: 'app_settings (instance-wide settings, starting with global SMTP)',
    up(db) {
      // The instance-level counterpart of workspaces.settings: one row per
      // setting key, value is JSON. The first key is 'smtp' — the global mail
      // server an admin configures in the admin area, used whenever a workspace
      // hasn't set its own. Nothing is backfilled: the SMTP_* env vars stay
      // readable as the last fallback, so an existing install keeps sending
      // mail with no admin action.
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at INTEGER
        )
      `)
    },
  },
  {
    version: 10,
    name: 'SMTP becomes instance-level: adopt a workspace config as the global one',
    up(db, ctx) {
      // SMTP used to be configurable per workspace. It is now one instance-wide
      // mail server owned by an admin, so `workspaces.settings.smtp` is no
      // longer read by anything. An install whose ONLY mail config was a
      // workspace's own would otherwise stop sending email at this upgrade —
      // adopt it as the global config instead.
      //
      // Only when nothing else answers: a saved global config or SMTP_HOST in
      // the environment already covers the whole instance, and with several
      // workspaces configured there is no principled way to pick between them
      // (the oldest one wins, and the admin can correct it in the UI).
      // The stale `settings.smtp` blocks are left in place — data nothing reads
      // is harmless, and dropping them would make a downgrade lossy.
      const hasGlobal = db.prepare("SELECT 1 FROM app_settings WHERE key = 'smtp'").get()
      if (hasGlobal || process.env.SMTP_HOST) return

      const rows = db.prepare('SELECT name, settings FROM workspaces ORDER BY created_at').all()
      for (const row of rows) {
        let smtp
        try {
          smtp = JSON.parse(row.settings || '{}').smtp
        } catch {
          continue
        }
        if (!smtp?.host) continue
        db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)').run(
          'smtp',
          JSON.stringify({
            host: smtp.host,
            port: smtp.port || '',
            secure: !!smtp.secure,
            user: smtp.user || '',
            from: smtp.from || '',
            // Workspace passwords were stored in the clear; the instance config
            // seals them like every other secret.
            pass: smtp.pass && ctx.encryptAppSetting ? ctx.encryptAppSetting(smtp.pass) : '',
          }),
          Date.now()
        )
        console.log(`📧 Adopted "${row.name}"'s SMTP settings as the instance-wide mail server (Administration → Email).`)
        break
      }
    },
  },
  {
    version: 11,
    name: 'users: failed-login counters + account lock (brute-force protection)',
    up(db) {
      // Consecutive failed sign-ins are counted on the account itself; past the
      // threshold the account is blocked (locked_at set) until an instance admin
      // unblocks it. locked_until is the expiry for the locks that do expire on
      // their own — an instance admin's cooldown, and LOGIN_LOCKOUT_MS when an
      // operator opts into self-healing blocks. NULL there = "until an admin
      // unblocks". Every existing account starts clean. See server/login-guard.js.
      db.exec(`ALTER TABLE users ADD COLUMN failed_logins INTEGER DEFAULT 0`)
      db.exec(`ALTER TABLE users ADD COLUMN last_failed_at INTEGER`)
      db.exec(`ALTER TABLE users ADD COLUMN locked_at INTEGER`)
      db.exec(`ALTER TABLE users ADD COLUMN locked_until INTEGER`)
    },
  },
  {
    version: 12,
    name: 'configurable workspace roles (roles + role_permissions), seeded with owner/member',
    up(db) {
      // Workspace roles stop being two hardcoded literals and become rows an
      // instance admin edits (server/permissions.js). Nothing is rewritten:
      // `workspace_members.role` already held 'owner'/'member' and those are
      // exactly the slugs seeded here, so every existing membership keeps the
      // access it had — the built-in 'owner' is seeded holding every permission
      // in the catalog, which is precisely what the old requireOwner guard
      // allowed.
      //
      // IF NOT EXISTS because fresh installs run the baseline AND this step.
      db.exec(`
        CREATE TABLE IF NOT EXISTS roles (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          description TEXT,
          builtin INTEGER DEFAULT 0,
          created_at INTEGER,
          updated_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS role_permissions (
          role_id TEXT NOT NULL,
          permission TEXT NOT NULL,
          UNIQUE(role_id, permission)
        );
        CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
      `)
      seedBuiltinRoles(db)

      // Pre-v8 memberships spell 'owner' as 'admin'. They are left alone —
      // server/permissions.js normalizes the spelling on read, the same way
      // memberRole always has, and rewriting them would make a downgrade lossy.
    },
  },
  // v13+: append plain, run-exactly-once steps here, e.g.
  {
    version: 13,
    name: 'spacetree_nodes: resource hierarchy for tree-based navigation and ownership',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS spacetree_nodes (
          id TEXT PRIMARY KEY,
          parent_id TEXT,
          type TEXT NOT NULL,          -- 'application' | 'workspace' | 'connection'
          resource_id TEXT,            -- FK to the actual resource (workspaces.id, connections.id); NULL for the application root
          name TEXT NOT NULL,
          owner_id TEXT,               -- the user who owns this node (ownership cascades to descendants)
          ts INTEGER NOT NULL,
          FOREIGN KEY(parent_id) REFERENCES spacetree_nodes(id)
        );
        CREATE INDEX IF NOT EXISTS idx_spacetree_parent ON spacetree_nodes(parent_id);
        CREATE INDEX IF NOT EXISTS idx_spacetree_owner ON spacetree_nodes(owner_id);
        CREATE INDEX IF NOT EXISTS idx_spacetree_type_resource ON spacetree_nodes(type, resource_id);
      `)

      // Seed the application root node. On a fresh install there are no admin
      // users yet (the first setup wizard creates one), so owner_id is left
      // NULL — it gets set when the first admin is created or claims it.
      const now = Date.now()
      const existing = db.prepare('SELECT 1 FROM spacetree_nodes WHERE type = ?').get('application')
      if (!existing) {
        db.prepare('INSERT INTO spacetree_nodes (id, parent_id, type, resource_id, name, owner_id, ts) VALUES (?, NULL, ?, NULL, ?, NULL, ?)').run(
          'root', 'application', 'Application', now
        )
      }

      // Backfill: every existing workspace gets a node under the application root.
      const workspaces = db.prepare('SELECT id, name, created_at FROM workspaces').all()
      for (const ws of workspaces) {
        const existingNode = db.prepare('SELECT 1 FROM spacetree_nodes WHERE type = ? AND resource_id = ?').get('workspace', ws.id)
        if (!existingNode) {
          db.prepare('INSERT INTO spacetree_nodes (id, parent_id, type, resource_id, name, owner_id, ts) VALUES (?, ?, ?, ?, ?, NULL, ?)').run(
            crypto.randomUUID(), 'root', 'workspace', ws.id, ws.name, ws.created_at || now
          )
        }
      }

      // Backfill: every existing connection gets a node under its workspace node.
      const connections = db.prepare('SELECT id, name, workspace_id, owner_id, updated_at FROM connections WHERE workspace_id IS NOT NULL').all()
      for (const conn of connections) {
        const parentNode = db.prepare('SELECT id FROM spacetree_nodes WHERE type = ? AND resource_id = ?').get('workspace', conn.workspace_id)
        if (!parentNode) continue
        const existingNode = db.prepare('SELECT 1 FROM spacetree_nodes WHERE type = ? AND resource_id = ?').get('connection', conn.id)
        if (!existingNode) {
          db.prepare('INSERT INTO spacetree_nodes (id, parent_id, type, resource_id, name, owner_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            crypto.randomUUID(), parentNode.id, 'connection', conn.id, conn.name,
            conn.owner_id || null, conn.updated_at || now
          )
        }
      }
    },
  },
  {
    version: 14,
    name: 'resource tree: resource_nodes + resource_grants, roles.applies_to; grants backfilled from memberships',
    up(db) {
      // The resource tree supersedes `spacetree_nodes` (v13), which only ever
      // held application/workspace/connection for navigation. Two things change:
      // nodes gain a group/resource split plus a materialized path (so "everything
      // under here" is one indexed LIKE instead of a recursive walk), and a grant
      // becomes a row on a *node* rather than a role column on a membership.
      //
      // v13's table is superseded, not dropped (additive-only) — see
      // DEPRECATED_TABLES. It is read once, below, so an install that already ran
      // v13 keeps whatever owners it recorded.
      db.exec(`
        CREATE TABLE IF NOT EXISTS resource_nodes (
          id TEXT PRIMARY KEY,
          parent_id TEXT,              -- NULL only for the application root
          kind TEXT NOT NULL,          -- 'group' (holds nodes) | 'resource' (a thing you use)
          type TEXT NOT NULL,          -- see NODE_TYPES in server/permissions-catalog.js
          resource_id TEXT,            -- id in the mirrored table; NULL for the root and custom groups
          name TEXT NOT NULL,
          owner_id TEXT,               -- owns this node and, by cascade, everything under it
          workspace_id TEXT,           -- the workspace this node lives in (NULL for the root)
          path TEXT NOT NULL,          -- materialized: '/root/<id>/<id>', ancestors in order
          depth INTEGER NOT NULL DEFAULT 0,
          sort INTEGER DEFAULT 0,
          created_at INTEGER,
          updated_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_resource_nodes_parent ON resource_nodes(parent_id);
        CREATE INDEX IF NOT EXISTS idx_resource_nodes_owner ON resource_nodes(owner_id);
        CREATE INDEX IF NOT EXISTS idx_resource_nodes_path ON resource_nodes(path);
        CREATE INDEX IF NOT EXISTS idx_resource_nodes_workspace ON resource_nodes(workspace_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_nodes_resource ON resource_nodes(type, resource_id);

        CREATE TABLE IF NOT EXISTS resource_grants (
          id TEXT PRIMARY KEY,
          node_id TEXT NOT NULL,
          principal_type TEXT NOT NULL,  -- 'user' | 'team'
          principal_id TEXT NOT NULL,
          role_slug TEXT NOT NULL,       -- roles.slug
          inherit INTEGER NOT NULL DEFAULT 1,  -- 0 = this node only, 1 = the whole subtree
          created_at INTEGER,
          created_by TEXT,
          UNIQUE(node_id, principal_type, principal_id, role_slug)
        );
        CREATE INDEX IF NOT EXISTS idx_resource_grants_node ON resource_grants(node_id);
        CREATE INDEX IF NOT EXISTS idx_resource_grants_principal ON resource_grants(principal_type, principal_id);
      `)

      // A role's requirement criteria: the node types it may be granted on.
      // JSON array, or NULL for "any type" — which is what every existing role
      // gets, so nothing an admin already defined narrows underneath them.
      db.exec(`ALTER TABLE roles ADD COLUMN applies_to TEXT`)
      for (const role of BUILTIN_ROLES) {
        if (!role.appliesTo) continue
        db.prepare('UPDATE roles SET applies_to = ? WHERE slug = ?').run(JSON.stringify(role.appliesTo), role.slug)
      }

      const now = Date.now()
      const insNode = db.prepare(
        `INSERT INTO resource_nodes (id, parent_id, kind, type, resource_id, name, owner_id, workspace_id, path, depth, sort, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )

      // v13 recorded an owner per node; carry it across where it exists so an
      // install that already ran v13 doesn't lose it. `legacy` is keyed by
      // "<type>:<resource_id>" and is empty on installs that skipped v13.
      const legacy = new Map()
      const hasLegacy = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'spacetree_nodes'").get()
      if (hasLegacy) {
        for (const r of db.prepare('SELECT type, resource_id, owner_id FROM spacetree_nodes').all()) {
          if (r.owner_id) legacy.set(`${r.type}:${r.resource_id || ''}`, r.owner_id)
        }
      }
      const legacyOwner = (type, resourceId) => legacy.get(`${type}:${resourceId || ''}`) || null

      // 1. The application root. Its id is the literal 'root' so the path of
      //    every node reads '/root/…' and the root is addressable without a lookup.
      const rootPath = '/root'
      insNode.run('root', null, 'group', 'application', null, 'Application', legacyOwner('application', null), null, rootPath, 0, now, now)

      // 2. Workspaces — group nodes under the root. The owner is the member
      //    holding the built-in `owner` role, so the tree agrees with the
      //    membership table from the first boot.
      const wsNode = new Map()
      for (const ws of db.prepare('SELECT id, name, created_at FROM workspaces ORDER BY created_at').all()) {
        const id = randomUUID()
        const owner =
          legacyOwner('workspace', ws.id) ||
          db.prepare("SELECT user_id FROM workspace_members WHERE workspace_id = ? AND role IN ('owner', 'admin') ORDER BY created_at LIMIT 1").get(ws.id)
            ?.user_id ||
          null
        insNode.run(id, 'root', 'group', 'workspace', ws.id, ws.name, owner, ws.id, `${rootPath}/${id}`, 1, ws.created_at || now, now)
        wsNode.set(ws.id, { id, path: `${rootPath}/${id}` })
      }

      // 3. Teams — group nodes under their workspace.
      for (const t of db.prepare('SELECT id, workspace_id, name, created_at FROM teams').all()) {
        const parent = wsNode.get(t.workspace_id)
        if (!parent) continue
        const id = randomUUID()
        insNode.run(id, parent.id, 'group', 'team', t.id, t.name, null, t.workspace_id, `${parent.path}/${id}`, 2, t.created_at || now, now)
      }

      // 4. Connections — resource nodes under their workspace.
      const connNode = new Map()
      for (const c of db.prepare('SELECT id, name, workspace_id, owner_id, updated_at FROM connections WHERE workspace_id IS NOT NULL').all()) {
        const parent = wsNode.get(c.workspace_id)
        if (!parent) continue
        const id = randomUUID()
        const owner = c.owner_id || legacyOwner('connection', c.id) || null
        insNode.run(id, parent.id, 'resource', 'connection', c.id, c.name, owner, c.workspace_id, `${parent.path}/${id}`, 2, c.updated_at || now, now)
        connNode.set(c.id, { id, path: `${parent.path}/${id}`, workspaceId: c.workspace_id })
      }

      // 5. Storage destinations — resource nodes under their workspace.
      for (const s of db.prepare('SELECT id, workspace_id, name, created_at FROM storage_destinations').all()) {
        const parent = wsNode.get(s.workspace_id)
        if (!parent) continue
        const id = randomUUID()
        insNode.run(id, parent.id, 'resource', 'storage', s.id, s.name, null, s.workspace_id, `${parent.path}/${id}`, 2, s.created_at || now, now)
      }

      // 6. Dashboards and workflows — resource nodes under their connection,
      //    which is where they actually live.
      for (const [table, type] of [
        ['dashboards', 'dashboard'],
        ['workflows', 'workflow'],
      ]) {
        for (const r of db.prepare(`SELECT id, connection_id, name, ts FROM ${table}`).all()) {
          const parent = connNode.get(r.connection_id)
          if (!parent) continue
          const id = randomUUID()
          insNode.run(id, parent.id, 'resource', type, r.id, r.name, null, parent.workspaceId, `${parent.path}/${id}`, 3, r.ts || now, now)
        }
      }

      // 7. Every membership becomes an inherited grant on its workspace node.
      //    This is the migration that makes the tree authoritative: after it,
      //    `permissionsIn(workspaceId, userId)` resolved through the tree returns
      //    exactly what `workspace_members.role` returned before. Pre-v8 rows
      //    spell 'owner' as 'admin' — normalized here, the same way memberRole
      //    has always normalized it on read.
      const insGrant = db.prepare(
        `INSERT OR IGNORE INTO resource_grants (id, node_id, principal_type, principal_id, role_slug, inherit, created_at, created_by)
         VALUES (?, ?, 'user', ?, ?, 1, ?, NULL)`
      )
      for (const m of db.prepare('SELECT workspace_id, user_id, role, created_at FROM workspace_members').all()) {
        const node = wsNode.get(m.workspace_id)
        if (!node) continue
        insGrant.run(randomUUID(), node.id, m.user_id, m.role === 'admin' ? 'owner' : m.role, m.created_at || now)
      }
    },
  },
  {
    version: 15,
    name: 'teams become group nodes: node_members, and grants name a node instead of a team',
    up(db) {
      // A team was two things wearing one id: a set of people (the grant
      // principal) and, since v14, a group node resources could be filed under.
      // The tree already models the second, so the first moves onto the node too
      // and `teams` stops being a concept. A grant principal is now 'user' or
      // 'node'.
      //
      // Membership gets its own table rather than a flag on `resource_grants`.
      // That is the whole safety property: a plain user grant on a group node
      // says "you may do X here" and must never be mistakable for "you are one of
      // these people" — because a grant elsewhere naming that group hands its
      // permissions to everyone inside it. A separate table makes the confusion
      // structurally impossible instead of one WHERE clause away.
      db.exec(`
        CREATE TABLE IF NOT EXISTS node_members (
          id TEXT PRIMARY KEY,
          node_id TEXT NOT NULL,       -- a resource_nodes row with kind = 'group'
          user_id TEXT NOT NULL,
          created_at INTEGER,
          UNIQUE(node_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_node_members_user ON node_members(user_id);
        CREATE INDEX IF NOT EXISTS idx_node_members_node ON node_members(node_id);
      `)

      // team id -> the node v14 created for it. Everything below is keyed on this,
      // so it must run before the nodes stop being findable by resource_id.
      const nodeForTeam = new Map()
      for (const n of db.prepare("SELECT id, resource_id FROM resource_nodes WHERE type = 'team'").all()) {
        if (n.resource_id) nodeForTeam.set(n.resource_id, n.id)
      }

      const now = Date.now()
      const insMember = db.prepare(
        'INSERT OR IGNORE INTO node_members (id, node_id, user_id, created_at) VALUES (?, ?, ?, ?)'
      )
      for (const m of db.prepare('SELECT team_id, user_id, created_at FROM team_members').all()) {
        const nodeId = nodeForTeam.get(m.team_id)
        if (!nodeId) continue
        insMember.run(randomUUID(), nodeId, m.user_id, m.created_at || now)
      }

      // Repoint both principal lists at the node. A team with no node (data from
      // before v14 that the backfill skipped) leaves its rows spelling 'team',
      // which the new resolver does not recognise — access is lost rather than
      // silently kept, which is the right way for this to fail.
      const setGrant = db.prepare('UPDATE resource_grants SET principal_type = ?, principal_id = ? WHERE principal_type = ? AND principal_id = ?')
      const setAccess = db.prepare('UPDATE connection_access SET principal_type = ?, principal_id = ? WHERE principal_type = ? AND principal_id = ?')
      for (const [teamId, nodeId] of nodeForTeam) {
        setGrant.run('node', nodeId, 'team', teamId)
        setAccess.run('node', nodeId, 'team', teamId)
      }

      // The nodes themselves become ordinary groups. They mirror nothing now, so
      // `resource_id` goes NULL — the unique index on (type, resource_id) counts
      // NULLs as distinct, so every converted team can hold one.
      db.prepare("UPDATE resource_nodes SET type = 'group', resource_id = NULL, updated_at = ? WHERE type = 'team'").run(now)
    },
  },
  {
    version: 16,
    name: 'one roster: workspace membership becomes node_members, and connection access stops defaulting open',
    up(db) {
      // A workspace node is a group like any other, so its roster belongs in the
      // same table every other group uses. `workspace_members` was the second
      // roster — and the one place two tables had to be kept saying the same
      // thing. Membership now says *who belongs* (and therefore who can see the
      // workspace's resources); the grant on the workspace node says *what they
      // may do*. A member with no grant is a real, useful state: they see
      // everything and can act on nothing.
      const now = Date.now()
      const wsNode = new Map()
      for (const n of db.prepare("SELECT id, resource_id FROM resource_nodes WHERE type = 'workspace'").all()) {
        if (n.resource_id) wsNode.set(n.resource_id, n.id)
      }

      const insMember = db.prepare('INSERT OR IGNORE INTO node_members (id, node_id, user_id, created_at) VALUES (?, ?, ?, ?)')
      for (const m of db.prepare('SELECT workspace_id, user_id, created_at FROM workspace_members').all()) {
        const nodeId = wsNode.get(m.workspace_id)
        if (!nodeId) continue
        insMember.run(randomUUID(), nodeId, m.user_id, m.created_at || now)
      }
      // The role itself needs no backfill: v14 already mirrored every membership
      // into a grant on its workspace node, and `syncMemberGrant` has kept them
      // in step since.

      // An empty `connection_access` list used to mean "open to every member".
      // It now means the opposite — nobody but the owner and whoever manages
      // connections — because a member seeing a connection and a member being
      // able to open it are different questions. Flipping the default silently
      // would revoke access on upgrade, so today's implicit answer is written
      // down first: the workspace node names exactly "everyone in this
      // workspace", which is what the empty list meant. One row per connection,
      // not one per member per connection.
      const insAccess = db.prepare(
        `INSERT OR IGNORE INTO connection_access (id, connection_id, principal_type, principal_id, created_at)
         VALUES (?, ?, 'node', ?, ?)`
      )
      const open = db.prepare(
        `SELECT c.id, c.workspace_id FROM connections c
          WHERE c.workspace_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM connection_access a WHERE a.connection_id = c.id)`
      ).all()
      for (const c of open) {
        const nodeId = wsNode.get(c.workspace_id)
        if (!nodeId) continue
        insAccess.run(randomUUID(), c.id, nodeId, now)
      }
    },
  },
  {
    version: 17,
    name: 'built-in roles regain the permissions the catalog says they hold',
    up(db) {
      // `seedBuiltinRoles` only ever *inserts* a role that is missing, so a
      // builtin seeded before a permission key existed never picked that key up.
      // The resource-tree keys arrived with v14, which is why an instance older
      // than that has an `owner` holding no `resources.organise` and no
      // `resources.grant`: a workspace owner who cannot file a connection into a
      // group or grant a role on one, while permissions-catalog.js defines that
      // role as literally every key there is. The UI was right to grey the
      // actions out — the row simply disagreed with the catalog.
      //
      // Built-in rows only, and purely additive: a custom role an admin wrote is
      // theirs, and nothing is ever removed here. The cost is that a permission
      // an admin deliberately took *off* a builtin comes back — the right trade
      // for `owner`, which is defined as the whole catalog, and moot for
      // `member`, which ships with none.
      const ins = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)')
      const find = db.prepare('SELECT id FROM roles WHERE slug = ? AND builtin = 1')
      for (const role of BUILTIN_ROLES) {
        const row = find.get(role.slug)
        if (!row) continue
        for (const permission of role.permissions) ins.run(row.id, permission)
      }
    },
  },
  {
    version: 18,
    name: 'schema drafts that belong to a workspace instead of a connection',
    up(db) {
      // "New schema → from scratch": a diagram designed before there is a
      // database to design it against. saved_queries can't hold one — its
      // connection_id is NOT NULL, and widening that would mean every reader of
      // a saved query having to handle a row with no connection. So the
      // connection-less kind gets its own table, and the dialect it targets
      // (which a connection would otherwise have answered) is stored on the row.
      // IF NOT EXISTS because a fresh install runs *both* halves: step v1 calls
      // ensureBaseSchema (which creates this table) and then every later step,
      // this one included. Same reason every table-adding step above is written
      // this way.
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_drafts (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          name TEXT NOT NULL,
          db_type TEXT NOT NULL,
          sql TEXT,
          created_by TEXT,
          ts INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_schema_drafts_workspace ON schema_drafts (workspace_id);
      `)
    },
  },
  {
    version: 19,
    name: 'schema drafts remember their diagram layout (positions, notes, groups)',
    up(db) {
      // A schema draft used to be its DDL and nothing else, so opening one
      // re-ran dagre and scattered the diagram the designer had arranged. The
      // layout is that arrangement — where each table, group region and note
      // sits — held as one JSON document beside the SQL rather than as columns,
      // because it is read and written whole by the editor and never queried.
      //
      // Both kinds of draft get it: a draft designed against a connection is a
      // saved_queries row (kind = 'schema'), a from-scratch one is a
      // schema_drafts row. Nullable, so every existing draft keeps opening —
      // a draft with no stored layout is simply one dagre still arranges.
      addColumn(db, 'saved_queries', 'layout TEXT')
      addColumn(db, 'schema_drafts', 'layout TEXT')
    },
  },
  {
    version: 20,
    name: 'schema drafts carry an audit trail (who started one, who last changed it)',
    up(db) {
      // A design is workspace work several people touch, so the Schema list and
      // the editor both have to answer "whose is this, and who moved it last".
      // Neither table could: `created_by` existed on schema_drafts (v18) and
      // nowhere on saved_queries, and neither row remembered *when* it was
      // started — `ts` is the last write, so a draft that has been saved once
      // has already forgotten its own beginning.
      //
      // Both kinds of draft get the same columns, because the two kinds are one
      // list: a from-scratch draft is a schema_drafts row, one designed against
      // a connection is a saved_queries row (kind = 'schema'), and the Schema
      // section renders them side by side. saved_queries gains them for every
      // kind rather than only 'schema' — a saved query is the same kind of
      // shared object, and a column that only some rows may fill would be a
      // second rule to remember at every write.
      addColumn(db, 'schema_drafts', 'updated_by TEXT')
      addColumn(db, 'schema_drafts', 'created_at INTEGER')
      addColumn(db, 'saved_queries', 'created_by TEXT')
      addColumn(db, 'saved_queries', 'updated_by TEXT')
      addColumn(db, 'saved_queries', 'created_at INTEGER')
      // Backfill only what is actually knowable. An existing row's one
      // timestamp is its last write, which is the closest thing to a start date
      // it has; *who* did it is lost, and stays NULL — an unattributed row must
      // read as "unknown", never as a plausible wrong person.
      db.exec('UPDATE schema_drafts SET created_at = ts WHERE created_at IS NULL')
      db.exec('UPDATE saved_queries SET created_at = ts WHERE created_at IS NULL')
    },
  },
]

// Tables kept only so an older image can still open a newer DB (rollback
// compat) — the live code must never read or write them. Add an entry here
// whenever a step supersedes a table instead of dropping it; this is the
// shopping list for an eventual cleanup step once the release floor has
// moved past every image that still used the table.
export const DEPRECATED_TABLES = [
  // NOTE: `sessions` was deprecated in step 7 and un-deprecated in step 8 — it
  // is once again live code's source of truth for logins (server/sessions/db.js).
  { table: 'saved_folders', supersededBy: 'folders', sinceStep: 3 },
  { table: 'domains', supersededBy: 'folders', sinceStep: 5 },
  { table: 'table_domains', supersededBy: 'connection_tables', sinceStep: 5 },
  { table: 'spacetree_nodes', supersededBy: 'resource_nodes', sinceStep: 14 },
  { table: 'teams', supersededBy: 'resource_nodes', sinceStep: 15 },
  { table: 'team_members', supersededBy: 'node_members', sinceStep: 15 },
  { table: 'workspace_members', supersededBy: 'node_members', sinceStep: 16 },
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
