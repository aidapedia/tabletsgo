# Metadata database (SQLite or PostgreSQL)

SQLite uses `META_DB` (`data/app.db` by default). PostgreSQL uses `META_DATABASE_URL` and needs a dedicated empty database (or schema) for a new install. The server reads and writes it through Prisma Client (`server/meta.js`); both engines declare the same models, so no route branches on the engine. PostgreSQL deployments require `libpq` and `pg_dump` (included in the Docker image). The metadata store is separate from the databases users open in the console.

The server keeps its own SQLite DB (separate from user connections) with these
tables. It holds no accounts: identity and authorization are Hayat's.

**Schema versioning:** the meta schema is managed by **Prisma Migrate**, one
history per engine (`prisma/sqlite/`, `prisma/postgresql/` — each a
`schema.prisma` plus `migrations/`). The app **migrates on boot**, before it
opens the store (`server/migrator/boot.js`), so a new image upgrades the schema
the first time it starts; a failed migration stops the boot. The same migrator
runs by hand with `npm run migrate` (`node scripts/migrate.js`), and the in-app
Docker updater runs it in a one-shot container before swapping containers, so a
failure keeps the old one. `npm run migrate -- --status` prints what is applied
and pending (exit code 2 when something is pending).

A brand-new database is built from `0_baseline`. An install made before Prisma is first brought to v22 by the
frozen legacy steps in `server/migrator/legacy/`, then `0_baseline` (which *is*
v22) is recorded as applied. Before anything changes on an existing install, the
DB is snapshotted to `data/backups/pre-migrate-{label}-{ts}.db` so a bad upgrade
can be rolled back by restoring it. Migrations are **append-only** (never edit a
shipped migration) and **additive-only** (no drops/renames), so an older image
can still open a newer DB — with one sanctioned exception:
`20261110000000_hayat_owns_identity` dropped the account, login, role, grant and
resource-tree tables when Hayat took identity and authorization over. Right before
it runs, the migrator writes their contents to `data/hayat-import-<time>.json`
for `hayat import` (README → Hayat). To change the meta schema, edit both `schema.prisma`
files and create a migration for each engine (see the `meta-schema` skill).

```sql
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  type TEXT,                    -- "sqlite" | "postgresql"
  name TEXT,
  workspace_id TEXT,
  environment TEXT,
  folder TEXT,
  tags TEXT,                    -- JSON array
  credentials TEXT,             -- AES-256-GCM ciphertext: JSON of host/port/username/password/
                                 -- filepath/database/uri/sslmode/auth/keychain (dialect-specific + secret)
  schema_version INTEGER DEFAULT 1,
  owner_id TEXT,                -- users.id of the creator/owner (defaults on create)
  data TEXT,                    -- legacy pre-encryption blob; NULL once migrated, kept for backfill
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE schema_migrations (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  forward_sql TEXT NOT NULL,    -- JSON array of executed statements
  rollback_sql TEXT,            -- JSON array, same length, null entries where not reversible
  reversible INTEGER NOT NULL,  -- 0/1 — false if any statement lacks a rollback
  status TEXT,                  -- 'active' | 'rollbacked' (NULL on legacy rows = active)
  executor_id TEXT,
  executor_name TEXT,
  ts INTEGER
);
CREATE TABLE saved_queries (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sql TEXT NOT NULL,
  kind TEXT,                    -- "query" | "schema"
  folder_id TEXT,               -- nullable FK to saved_folders.id
  layout TEXT,                  -- kind="schema" only: the diagram design (JSON: table/group/note positions)
  ts INTEGER
);
CREATE TABLE schema_drafts (    -- a schema designed with no connection behind it
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  db_type TEXT NOT NULL,        -- the dialect its DDL targets (a connection would have answered this)
  sql TEXT,
  layout TEXT,                  -- the diagram design (JSON: table/group/note positions)
  created_by TEXT,
  ts INTEGER
);
CREATE TABLE saved_folders (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT,               -- nullable self-FK to saved_folders.id (NULL = root); enables nesting
  ts INTEGER
);
CREATE TABLE folders (          -- one polymorphic tree per (connection, type)
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  type TEXT NOT NULL,           -- "query" | "dashboard" | "workflow" | "table"
  name TEXT NOT NULL,
  color TEXT,                   -- hex color string, e.g. "#6366f1" (nullable)
  parent_id TEXT,               -- nullable self-FK (NULL = root); enables nesting
  ts INTEGER
);
CREATE TABLE connection_tables (  -- per-table metadata, one row per (connection, table)
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  folder_id TEXT,               -- nullable FK to folders.id (type="table"); NULL = ungrouped
  ts INTEGER,
  UNIQUE(connection_id, table_name)
);
-- Tables live in the user's database, so this row is where anything the app
-- knows about a table hangs. Folder membership is the first such fact; future
-- per-table config (access, display, …) becomes additional columns here.
-- domains / table_domains: DEPRECATED, superseded by the two tables above in
-- meta migration v5. Kept for rollback compatibility; no live code reads them.
CREATE TABLE query_history (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  table_name TEXT,             -- best-effort table touched by the query
  query TEXT NOT NULL,
  status TEXT NOT NULL,        -- "success" | "failed"
  latency INTEGER,             -- execution latency in ms
  error TEXT,
  executor_id TEXT,
  executor_name TEXT,
  ts INTEGER                   -- execution time (epoch ms)
);
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  name TEXT NOT NULL,
  graph TEXT,                  -- JSON { nodes, edges } (React Flow shape)
  ts INTEGER,
  protected INTEGER DEFAULT 0,        -- 1 = undeletable; nothing sets this automatically today
  schedule_enabled INTEGER DEFAULT 0, -- "Active" toggle for the graph's Schedule node
  next_run_at INTEGER                 -- epoch ms; scheduler's due-check cursor
);
CREATE TABLE storage_destinations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  endpoint TEXT,               -- custom S3-compatible endpoint (MinIO/R2/B2/…); NULL = AWS default
  region TEXT,
  bucket TEXT NOT NULL,
  path_prefix TEXT,
  force_path_style INTEGER,    -- 0/1 — required by most non-AWS S3-compatible services
  credentials TEXT,            -- AES-256-GCM ciphertext: JSON {accessKeyId, secretAccessKey, sessionToken?}
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE ssh_keys (                -- meta migration v21
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  algorithm TEXT,              -- 'ssh-ed25519' | 'ssh-rsa' | 'ecdsa-sha2-nistp256'
  public_key TEXT NOT NULL,    -- OpenSSH one-liner (what goes in authorized_keys)
  fingerprint TEXT,            -- SHA256:…
  credentials TEXT,            -- AES-256-GCM ciphertext: JSON {privateKey, passphrase?}
  created_by TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE ssh_gateways (            -- meta migration v21
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER,                -- default 22
  username TEXT,
  auth TEXT,                   -- 'key' | 'password'
  key_id TEXT,                 -- ssh_keys.id when auth = 'key'
  transport TEXT,              -- 'tcp' (NULL reads as tcp) | 'cloudflare' — meta migration v22
  host_fingerprint TEXT,       -- pinned on first login (trust on first use)
  credentials TEXT,            -- AES-256-GCM ciphertext: JSON {password?, cfClientId?, cfClientSecret?}
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,  -- denormalized for per-day aggregate queries
  trigger_kind TEXT NOT NULL,   -- "manual" | "schedule"
  status TEXT NOT NULL,         -- "success" | "failed"
  log TEXT,                     -- JSON: the per-node log[] runWorkflow() produces
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  ts INTEGER NOT NULL
);
CREATE TABLE backup_schedules (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL UNIQUE,
  frequency TEXT NOT NULL,        -- "hourly" | "daily"
  hour_of_day INTEGER,
  destination_ids TEXT,           -- JSON array of storage_destinations.id (or the reserved "local"); empty ⇒ local server disk
  retry_limit INTEGER DEFAULT 0,        -- extra attempts after a scheduled failure (0-5)
  retry_delay_sec INTEGER DEFAULT 60,   -- delay between attempts
  retention_days INTEGER DEFAULT 0,     -- prune uploads older than this after each run (0 = never)
  encrypt INTEGER DEFAULT 0,      -- encrypt the dump (AES-256-GCM, server-derived key) before upload
  include_config INTEGER DEFAULT 0, -- also upload the connection's export JSON (never with secrets)
  enabled INTEGER DEFAULT 1,      -- "Active" toggle
  next_run_at INTEGER,            -- epoch ms; scheduler's due-check cursor
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE backup_runs (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,     -- "manual" | "schedule" | "retry"
  status TEXT NOT NULL,           -- "success" | "failed"
  error TEXT,
  uploads TEXT,                   -- JSON: [{destinationId, ok, key?, sizeBytes?, encrypted?, error?, prunedCount?, deleted?, configKey?, configSizeBytes?, configEncrypted?, configError?}]
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  ts INTEGER NOT NULL
);
-- Instance-wide settings an admin edits (server/app-settings.js) — the
-- instance-level counterpart of workspaces.settings. Key/value on purpose: a
-- new instance-wide setting is a new key, not a new table.
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,           -- "smtp" (the global mail server) today
  value TEXT,                     -- JSON; secrets inside it are AES-256-GCM sealed
  updated_at INTEGER
);
```

**First run:** nothing is seeded. People, workspaces (Hayat tenants) and who may
do what live in Hayat; a workspace's row here appears the first time a member
lists their workspaces, and holds only tabletsgo's settings for it.
