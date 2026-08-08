# Backend API Documentation

Reference for migrating the Tabletsgo backend (`server.js`). Lists every HTTP
endpoint with its request, response, and an example URL.

---

## Conventions

- **Base URL:** `http://localhost:3000` (port from `PORT` env, default `3000`).
- **API prefix:** all endpoints live under `/api`.
- **Content type:** requests and responses are JSON. JSON body limit is `10mb`.
- **CORS:** enabled for all origins (`cors()` with defaults).
- **Auth:** login/setup/accept-invite return `{ user, token }`. Send the token as
  `Authorization: Bearer <token>` on subsequent calls. Workspace, member and every
  per-connection route (`/api/connections/:id/*`) require it and enforce workspace
  membership; unauthenticated → `401`, non-member → `403`.
- **Roles** come in two independent tiers:

  | Tier | Stored in | Values | Can do |
  | --- | --- | --- | --- |
  | System | `users.role` (on `user.role` in every auth response) | `admin` \| `user` | `admin` manages workspaces and accounts via `/api/admin/*` — and *nothing else*. An instance admin holds **no** workspace membership, so every workspace-scoped route `403`s for them by design. |
  | Workspace | the user grant on the workspace's node | any **role slug** from the instance catalog | Configurable: an instance admin defines what each role grants (see **Roles & permissions**), and routes authorize by *permission*, never by role name. `owner` and `member` are seeded builtins. "Owner" means *holds `workspace.manage`* — a workspace may have **any number of owners but never zero**. Neither tier grants database access on its own: *using* a connection comes from its own access list. |

  Workspace-tier refusals return
  `403 { "error": "You do not have permission to do that.", "permission": "<key>" }`
  when the caller is a member of the workspace and
  `403 { "error": "Forbidden" }` when they aren't;
  admin-only routes return `403 { "error": "Admin access required" }`.
  The workspace role used to be spelled `admin`; meta migration v8 rewrites it
  to `owner` in place, and the server also normalizes it on read so a
  rolled-back-then-forward DB never exposes a mixed vocabulary.
- **Error shape:** errors return `{ "error": "<message>" }` with an HTTP status of
  `400` (bad input), `401` (bad login), `404` (not found), or `500` (server error).
  The query/insert/test routes return DB errors in the body too (see each route).
- **Path params:** `:id` = connection id, `:table` = table name, `:sid` = saved
  query id, `:fid` = folder id.
- **Query params** (where supported):
  - `database` — target database on the same server (PostgreSQL multi-db browsing;
    on Redis the numbered database, as `db0`…`dbN` or a bare index).
  - `schema` — target schema (PostgreSQL, default `public`).
  - `limit` — row cap for table data (default `200`).
- **Engines:** `sqlite`, `postgresql`, `redis`. Routes that only make sense for a
  relational engine (`/columns`, `/indexes`, `/diagram`, `/insert`, `/analyze`,
  `/table/:table`, backups) reject a Redis connection with a `400` naming the type;
  `/tables` and `/objects` return `[]`. Redis browses its keyspace through the
  `/redis/*` routes below and runs commands through the shared `/query` route.

### Environment variables

| Variable  | Default            | Purpose                                  |
| --------- | ------------------ | ---------------------------------------- |
| `PORT`    | `3000`             | HTTP listen port.                        |
| `META_DB` | `./data/app.db`    | SQLite file storing app metadata (below).|
| `ENCRYPTION_KEY` | *(required)* | AES-256-GCM key encrypting connection credentials at rest — server refuses to start without it. Also derives (with a distinct salt) the key used for storage-destination credentials. |
| `WORKFLOW_SCHEDULER_ENABLED` | `true` | Set to `false` to disable the minutely cron tick that fires workflows with an active hourly/daily schedule (including backups). Useful for local dev/CI. |
| `LOGIN_MAX_ATTEMPTS` | `5` | Consecutive failed sign-ins that block an account. `0` disables blocking. |
| `LOGIN_ATTEMPT_WINDOW_MS` | `900000` (15 min) | How close together those failures must be — an older failure restarts the counter. |
| `LOGIN_LOCKOUT_MS` | `0` | How long a block lasts. `0` = until an instance admin unblocks the account. |
| `LOGIN_ADMIN_COOLDOWN_MS` | `900000` (15 min) | An instance admin is never blocked indefinitely — they get this cooldown instead. `0` leaves admin sign-ins unthrottled. |

**System requirement:** PostgreSQL backup/restore shells out to `pg_dump`/`pg_restore`, so the `postgresql-client` package must be installed on the host/image running `server.js` (already added to the provided `Dockerfile`).

### Static frontend

If a `dist/` build exists, it is served as static files with an SPA fallback:
any non-`/api/...` GET returns `dist/index.html`. Otherwise unknown routes return
`404 { "error": "Not found" }`.

---

## Data models

### Connection
The API request/response shape is unchanged from before — a flat object.
Server-side storage is split (dialect-agnostic fields as plain columns,
everything else encrypted — see Metadata database below), but `rowToConnection`
reassembles this same shape on every read, so API consumers see no difference:

```jsonc
// SQLite
{
  "id": "demo-sqlite",
  "name": "Demo Database",
  "type": "sqlite",
  "environment": "local",
  "filepath": "./demo.db",
  "folder": "Demo",
  "schemaVersion": 1,          // bumped by POST .../schema/migrations
  "ownerId": "user_1",         // creator by default; see POST /api/connections
  "ownerName": "Alice",        // resolved read-only (owner's display name)
  "ownerEmail": "alice@x.com"  // resolved read-only (owner's email)
}

// PostgreSQL
{
  "id": "f1e2...uuid",
  "name": "Prod",
  "type": "postgresql",
  "environment": "production",
  "host": "db.example.com",
  "port": 5432,
  "username": "app",
  "password": "secret",
  "database": "appdb",
  "auth": "none",            // optional: "none" skips user/password
  "sslmode": "verify-full",  // optional: disable | require | verify-full
  "schemaVersion": 1
}

// Redis — reuses the same field names as PostgreSQL, so nothing downstream
// (encryption at rest, export/import, the detail view) needs a Redis branch.
{
  "id": "a1b2...uuid",
  "name": "Session cache",
  "type": "redis",
  "environment": "production",
  "host": "cache.example.com",
  "port": 6379,
  "username": "app",        // optional: Redis 6+ ACL user
  "password": "secret",     // optional
  "auth": "password",       // optional: "none" skips user/password
  "database": "0",          // the numeric db index to open by default
  "tls": "require",         // optional: "" (plain) | "require" | "insecure"
  "uri": "redis://user:pass@cache.example.com:6379/0", // optional; wins over the fields above
  "schemaVersion": 1        // never bumps — Redis has no DDL
}
```

A `redis://` / `rediss://` URI's `/N` path is only the *default* database: an
explicit `?database=` on a request always wins, so the console's database picker
works on URI-configured connections too.

### Saved query
```jsonc
{
  "id": "uuid",
  "name": "Active users",
  "sql": "SELECT * FROM users WHERE active = 1",
  "kind": "query",      // "query" | "schema"
  "folderId": null,     // folder id or null (root)
  "ts": 1719600000000   // epoch ms
}
```

### Folder
```jsonc
{
  "id": "uuid",
  "name": "Reports",
  "color": "#6366f1",   // hex accent color or null (any type; used by table folders)
  "parentId": null,     // parent folder id or null (root) — folders nest into subdirectories
  "type": "query",      // "query" | "dashboard" | "workflow" | "table"
  "ts": 1719600000000,
  "tables": ["orders", "order_details"]  // type="table" only: the tables grouped in this folder
}
```
Folders of `type: "table"` group the connected database's tables. A table belongs
to **at most one** folder; membership lives server-side in `connection_tables`,
the per-table metadata row (tables themselves aren't rows in the metadata DB). These replaced the old *domains* concept
in meta migration v5 — each domain became a root-level table folder, keeping its
id, name and color, so old domain ids still resolve.

### Query history entry
```jsonc
{
  "id": "uuid",
  "table": "users",          // best-effort table name, may be null
  "query": "SELECT * FROM users",
  "status": "success",       // "success" | "failed"
  "latency": 12,              // execution latency in ms (nullable)
  "error": null,             // error message when status = "failed"
  "executorId": "user-uuid",
  "executorName": "Admin",   // resolved display name (falls back to id)
  "executedAt": 1719600000000 // epoch ms
}
```

### Column (from `/columns` and `/diagram`)
```jsonc
{
  "name": "user_id",
  "type": "integer",
  "notnull": true,
  "pk": false,
  "default": null,          // raw default expression as the dialect reports it, e.g. "nextval('t_id_seq'::regclass)"
  "autoIncrement": false,   // database assigns this column when the INSERT omits it
  "references": { "table": "users", "column": "id" } // null when not a foreign key (only on /columns)
}
```

`autoIncrement` is normalized per dialect so clients never have to sniff the
`default` string: PostgreSQL reports it for identity columns (`is_identity = 'YES'`)
and `serial` (`nextval(...)` default); SQLite reports it for the rowid alias (the
sole `INTEGER PRIMARY KEY` on a rowid table). A column is safe to omit from an
`INSERT` when it is nullable, has a `default`, or is `autoIncrement`.

### Query result (from `/query`)
```jsonc
// SELECT
{ "type": "rows", "columns": ["id", "name"], "rows": [{ "id": 1, "name": "A" }] }
// non-SELECT — `rowCount` lets a caller tell a statement that changed nothing
// (0-row UPDATE/DELETE: not an error, but not a success either) from one that did
{ "type": "message", "message": "Query OK · 3 row(s) affected.", "rowCount": 3 }
// failure (HTTP 200, error in body)
{ "error": "no such table: foo" }
```

---

## Metadata database (`data/app.db`, SQLite)

The server keeps its own SQLite DB (separate from user connections) with these
tables.

**Schema versioning:** the meta schema is managed by versioned, stepped
migrations in `server/migrations.js`. `PRAGMA user_version` records the last
applied step; on boot, every pending step runs in its own transaction (oldest
first) and stamps `user_version` as it goes. Before the first pending step
touches an existing install, the DB file is snapshotted to
`data/backups/pre-migrate-v{N}-{ts}.db` so a bad upgrade can be rolled back by
restoring the file. Steps are **append-only** (never edit a shipped step) and
**additive-only** (no drops/renames), so an older image can still open a newer
DB. To change the meta schema, append a new step to the `MIGRATIONS` array —
don't edit the `CREATE TABLE` baseline (it only applies to fresh installs).

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,  -- sha256(password) hex
  name TEXT,
  role TEXT,                    -- system role: "admin" (instance admin) | "user"
  -- Brute-force guard (server/login-guard.js). On the account rather than in
  -- memory, so a block survives a restart and an admin can see it.
  failed_logins INTEGER DEFAULT 0, -- consecutive failures inside the window
  last_failed_at INTEGER,       -- when the last one was (older than the window ⇒ counter restarts)
  locked_at INTEGER,            -- NULL = not blocked
  locked_until INTEGER          -- NULL = blocked until an admin lifts it; set = self-expiring
);
-- The durable login store. One row per bearer token; the server reads it
-- through a cache (in-process, or Redis when SESSION_REDIS_URL is set), so a
-- login survives a restart, a flushed cache and a Redis outage.
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,        -- indexed: "sign this user out everywhere"
  created_at INTEGER,
  ns TEXT,                      -- "auth" (the store's namespace)
  context TEXT,                 -- JSON: the session value (userId, ip, userAgent, …)
  expires_at INTEGER            -- SQLite has no TTL, so reads filter on this
);
-- Workspace roles an instance admin defines (server/permissions.js). The slug is
-- what a grant stores, so it is fixed at creation; renaming a role
-- therefore never touches a membership row. 'owner' and 'member' are seeded
-- builtins whose slugs match the literals that column held before roles became
-- configurable, which is why migration v12 rewrote nothing.
CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,    -- stored in resource_grants.role_slug
  name TEXT NOT NULL,
  description TEXT,
  builtin INTEGER DEFAULT 0,    -- 1 = seeded; editable, never deletable
  applies_to TEXT,              -- v14: JSON array of node types this role may be
                                -- granted on; NULL = any type. Half of a grant's
                                -- requirement criteria (the other half is each
                                -- permission's `scope` in the catalog).
  created_at INTEGER,
  updated_at INTEGER
);
-- Seeding only ever *inserts* a builtin that is missing, so a role an admin has
-- edited is left as they left it. That also meant a builtin seeded before a
-- permission key existed never picked it up — an install older than v14 had an
-- `owner` with no `resources.organise`/`resources.grant`, i.e. a workspace owner
-- who could not move a node or grant a role on one. Meta migration **v17** tops
-- the builtins back up to the catalog's definition (additively, builtins only).
-- What a role grants. Rows are permission KEYS from the catalog in
-- server/permissions-catalog.js — the catalog is code, the grants are data. A key
-- this image doesn't recognise is ignored on read, which is what lets an older
-- image open a newer DB.
CREATE TABLE role_permissions (
  role_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  UNIQUE(role_id, permission)
);
-- The resource tree (v14, server/resource-tree.js): one hierarchy of everything
-- on the instance. Supersedes spacetree_nodes (v13), which is left in place but
-- never read — see DEPRECATED_TABLES.
--
-- `path` is materialized ('/root/<id>/<id>') so "everything under here" is one
-- indexed prefix match and walking to the root costs a single query — which
-- matters because the route guards are synchronous and resolve through this.
CREATE TABLE resource_nodes (
  id TEXT PRIMARY KEY,          -- the application root is literally 'root'
  parent_id TEXT,               -- NULL only for the application root
  kind TEXT NOT NULL,           -- 'group' (holds nodes) | 'resource' (a thing you use)
  type TEXT NOT NULL,           -- application|workspace|group|connection|storage|dashboard|workflow
  resource_id TEXT,             -- id in the mirrored table; NULL for the root and custom groups
  name TEXT NOT NULL,
  owner_id TEXT,                -- owns this node and, by cascade, everything under it
  workspace_id TEXT,            -- the workspace this node lives in (NULL for the root)
  path TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  sort INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);
-- A role handed to a principal at a node. This is where workspace permissions
-- now come from: migration v14 backfilled one inheriting grant per membership,
-- and server/workspaces.js keeps the two in step on every add/role-change/remove.
CREATE TABLE resource_grants (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  principal_type TEXT NOT NULL, -- 'user' | 'node'
  principal_id TEXT NOT NULL,
  role_slug TEXT NOT NULL,      -- roles.slug
  inherit INTEGER NOT NULL DEFAULT 1, -- 0 = this node only, 1 = the whole subtree
  created_at INTEGER,
  created_by TEXT,
  UNIQUE(node_id, principal_type, principal_id, role_slug)
);
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
-- Who is inside a group. A group node is both a folder resources are filed
-- under and the set of people a grant can name, so this is the roster a grant
-- to that group reaches. Deliberately its own table rather than a flag on
-- resource_grants: a plain user grant on a group node must never be mistakable
-- for membership. Superseded `teams`/`team_members` in meta migration v15
-- (both kept, unread, for rollback compatibility).
-- The one roster table. A workspace node uses it too (v16): a workspace is a
-- group like any other, so `workspace_members` became a second roster that had
-- to be kept saying the same thing, and is now deprecated. Belonging and role
-- are two facts on the same node — this says who is in it (and therefore who
-- sees everything inside it), the grant on that node says what they may do. A
-- member holding no grant is a real state: sees everything, may do nothing.
CREATE TABLE node_members (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,          -- resource_nodes.id, kind = 'group' (incl. workspace nodes)
  user_id TEXT NOT NULL,
  created_at INTEGER,
  UNIQUE(node_id, user_id)
);
CREATE TABLE connection_access (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,   -- "node" | "user"
  principal_id TEXT NOT NULL,     -- resource_nodes.id (a group) or users.id
  created_at INTEGER,
  UNIQUE(connection_id, principal_type, principal_id)
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

**Seeds on first run:** user `admin` / `admin123` (system role `admin`), and a
`demo-sqlite` connection pointing at `./demo.db` (auto-seeded with sample data
when empty). Note the seeded admin is an *instance* admin, so the seeded
workspace has no owner until the admin assigns one (`PUT /api/admin/workspaces/:id/members/:userId`).

---

# Endpoints

## Auth & setup

`user` shape: `{ id, email, name, role }` — `role` here is the **system** role
(`admin` | `user`), not a workspace role. `{ user, token }` is returned by login,
setup and accept-invite; store the token and send it as `Authorization: Bearer`.

**Where the token lives.** The meta DB's `sessions` table is the source of truth,
read through a cache — in-process by default, or Redis when `SESSION_REDIS_URL`
is set (`server/sessions/`). The practical consequences:

- a login survives a server restart, a flushed cache, and a Redis outage (a cache
  failure degrades to a slower DB read, it never signs anyone out);
- with more than one replica, set `SESSION_REDIS_URL` so they share the cache —
  but they already share the logins themselves through the DB;
- the lifetime slides on every request (`SESSION_TTL_MS`, default 30 days). The
  DB is only rewritten once ~10% of that has elapsed, so the sliding expiry
  doesn't put a write in front of every authenticated request;
- revocation (logout, password reset, role change) deletes the row and evicts the
  cached copy. Another replica stops honouring the token once its cached copy
  lapses (≤60s).

**Setup** creates the first account as an *instance admin*, which by design holds
no workspace membership — so the workspace it names is created ownerless, and the
admin's first job is `POST /api/admin/users` + `PUT /api/admin/workspaces/:id/members/:userId`.

### POST `/api/auth/login`
- **Body:** `{ "username": "you@example.com", "password": "…" }` (`username` is the email)
- **200:** `{ "user": { … }, "token": "uuid" }` · **401:** `{ "error": "Invalid email or password" }`
- **423:** `{ "error": "…", "blocked": true, "lockedUntil": 1735689600000 | null }` — the
  account is blocked by the brute-force guard (below). `lockedUntil` is `null`
  when only an admin can lift it.
- **Example:** `POST http://localhost:3000/api/auth/login`

**Brute-force protection** (`server/login-guard.js`). `LOGIN_MAX_ATTEMPTS`
consecutive failures (default 5) inside `LOGIN_ATTEMPT_WINDOW_MS` (default 15
min) block the account; an older failure doesn't count, so the counter restarts
rather than accumulating over weeks. The state lives on the account
(`users.failed_logins / last_failed_at / locked_at / locked_until`), so a block
survives a restart and is visible in `GET /api/admin/users`.

- The block is checked **before** the password is verified: a blocked account
  can't be probed, and a guessed-correctly password doesn't bypass it.
- A blocked account is *told* it's blocked, which does reveal the address exists
  — deliberate, since the person needs to know why and whom to ask. An unknown
  address is never counted and always gets the generic 401.
- **An instance admin is never blocked indefinitely** (nobody would be left to
  unblock them). They get `LOGIN_ADMIN_COOLDOWN_MS` (default 15 min) instead —
  same threshold, always self-expiring, so the account is neither brute-forceable
  nor lockable-out by an attacker. Set it to `0` to leave admin logins unthrottled.
- **Clearing it:** `POST /api/admin/users/:id/unblock`, or any password change
  (`PUT /api/admin/users/:id` with `password`, or the reset-link flow). A
  successful sign-in resets the counter.
- `LOGIN_LOCKOUT_MS` (default `0` = until an admin unblocks) makes ordinary
  blocks self-expire too.

### POST `/api/auth/logout`
Invalidate the current session token. **200:** `{ "ok": true }`

### Your own account (auth required)

The self-service counterpart of `/api/admin/users/*`: these act on the caller and
only on the caller, so they need no role beyond a valid token. **Email is not
editable here** — it's the sign-in identity, and changing it (like the system
role) is an instance-admin action via `PUT /api/admin/users/:id`.

#### GET `/api/auth/me`
The caller's own profile, re-read from the DB (clients cache it in localStorage).
- **200:** `{ "user": { "id", "email", "name", "role" } }` · **401:** unauthenticated
- **Example:** `GET http://localhost:3000/api/auth/me`

#### PATCH `/api/auth/profile`
Rename yourself. `name` is the only self-editable profile field.
- **Body:** `{ "name": "Ada Lovelace" }`
- **200:** `{ "user": { … } }` · **400:** `{ "error": "A name is required." }` (empty/blank)
- **Example:** `PATCH http://localhost:3000/api/auth/profile`

#### POST `/api/auth/password`
Change your own password. The current password is **required and re-checked
server-side** — a session token alone must not let someone lock its owner out.
A success invalidates *every* session for the user (this browser's included,
since a stolen copy of the token is indistinguishable from it) and returns a
fresh one, so the caller stays signed in where they are and is signed out
everywhere else. It also clears any brute-force block, like every other password
change.
- **Body:** `{ "currentPassword": "…", "newPassword": "…" }`
- **200:** `{ "user", "token" }` — **persist the new token**, the old one is dead
- **400:** `{ "error": "Both your current and new password are required." }` ·
  `{ "error": "Your current password is incorrect." }` ·
  `{ "error": "The new password must be different from the current one." }`
- **Example:** `POST http://localhost:3000/api/auth/password`

### POST `/api/auth/forgot`
Request a password-reset link. **Always 200** `{ "ok": true }` — never reveals
whether the email exists. When SMTP is available (the global/env config, else
any of the user's workspaces' SMTP) the reset link is emailed; the link is
**never** returned.
- **Body:** `{ "email" }`

### GET `/api/auth/reset/:token`
Validate a reset token. **200:** `{ "email" }` · **404:** invalid/expired.

### POST `/api/auth/reset/:token`
Set a new password, invalidate the user's other sessions, and log in.
- **Body:** `{ "password" }` → **200:** `{ "user", "token" }` · **404:** invalid/expired · **400:** missing password

### GET `/api/setup`
First-run status. **200:** `{ "needsSetup": true }` (true when no users exist).

### POST `/api/setup`
Create the admin + first workspace (only while `needsSetup`).
- **Body:** `{ "email", "password", "name", "workspace" }`
- **200:** `{ "user", "token" }` · **403:** already completed · **400:** missing fields

### GET `/api/invite/:token`
Validate an invite. **200:** `{ "email", "workspaceName" }` · **404:** invalid/expired.

### POST `/api/invite/:token/accept`
Set password, activate, log in. **Body:** `{ "name", "password" }` → **200:** `{ "user", "token" }`.

---

## Resource tree (auth required)

One hierarchy of every addressable thing on the instance, and **the place a role
is granted**. Since meta v14 this tree — not a role column — is what
every `requirePermission(...)` resolves through (`server/resource-tree.js`).

```
Application (root, one per instance)
└── Workspace                     group — mirrors a `workspaces` row
        ├── Group                     group — created by hand, mirrors nothing
    ├── Storage                   resource
    └── Connection                resource
        ├── Dashboard             resource
        └── Workflow              resource
```

A **group** node holds other nodes and is where you organise and grant; a
**resource** node is a thing someone uses. The closed list of types, and which
type may parent which, lives in `server/permissions-catalog.js`.

### How a permission resolves

A grant is `(node, principal, role, inherit)`. Answering "may this user do X
here" walks the node's ancestors root-first and unions what each grant carries:

* **Ownership short-circuits.** `ownerId` on any ancestor ⇒ every permission in
  that subtree. This is what "the owner of a node can do anything under it"
  means, and why the application root's owner is instance-wide.
* **`inherit` decides reach.** `true` applies to the whole subtree; `false`
  applies to that node alone — how you grant one connection without the workspace.
* **A principal is a user or a group**, resolved through `node_members` — the
  roster of the group node the grant names. Membership is flat (a group holds
  users, never other groups), so nesting a group under another organises
  resources and says nothing about who belongs to it: re-filing a folder never
  hands anyone access.

Memberships still exist and still decide *membership* (which is what gates
opening a database); `server/workspaces.js` mirrors each one into a grant on its
workspace node so the two can never drift.

> **An instance admin sees the whole tree and resolves to every permission on it
> (they hold the root), but still holds no membership anywhere — so they cannot
> open a database.** Visibility and data access are separate questions;
> `connection_access` answers the second one.

### Requirement criteria

Two independent tests decide whether a role may be granted on a node, and both
must pass:

1. **`roles.applies_to`** — a JSON array of node types an admin restricted the
   role to, or `null` for "anywhere".
2. **Permission scope** — every permission the role carries must be meaningful at
   that node type (each key declares a `scope` in the catalog). Granting a role
   holding `workspace.manage` on a single connection is refused rather than
   stored as a promise no route can keep.

Both are applied on write *and* published to the client, so the grant editor can
only offer what the server would accept.

### GET `/api/resource-tree`

The whole tree the caller can see, flat — the client nests it via `parentId`.

**Sample URL:** `http://localhost:3000/api/resource-tree`

**Response:** `[{ id, parentId, kind, type, resourceId, name, ownerId, workspaceId, path, depth, context, owned, memberCount, canOrganise, canOpen }]`

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Node id (the application root is literally `"root"`) |
| `parentId` | string \| null | Parent node id; null only for the application root |
| `kind` | `"group"` \| `"resource"` | Holds other nodes, or is a thing you use |
| `type` | `"application"` \| `"workspace"` \| `"group"` \| `"connection"` \| `"storage"` \| `"dashboard"` \| `"workflow"` | Node type |
| `resourceId` | string \| null | Id in the mirrored table; null for the root and custom groups |
| `name` | string | Display name |
| `ownerId` | string \| null | Owns this node and, by cascade, everything under it |
| `workspaceId` | string \| null | The workspace this node lives in (null for the root) |
| `path` | string | Materialized ancestor path, `/root/<id>/<id>` |
| `depth` | number | 0 at the root |
| `context` | boolean | Present only so descendants have a path back to the root — the caller holds nothing here. Still selectable: `GET /api/resource-tree/:id` answers for it, scoped |
| `owned` | boolean | The caller owns this node outright |
| `memberCount` | number \| undefined | Groups only: how many people a grant to this group would reach |
| `canOrganise` | boolean | Whether the caller may reorganise **here**: file a new group in (`POST /api/resource-tree/:id/groups`, groups only) and re-file this node (`PUT /api/resource-tree/:id/move`). Resolved at the node, so a grant deep in the tree says yes without one above it — it is what lets the UI offer "new group" and "move" only where they are allowed. Answered for resources too: the move guard asks at the node being moved, not at its parent |
| `canOpen` | boolean \| undefined | Connections only: whether the caller may actually open the database |

An instance admin gets every node. Everyone else gets the nodes they own or hold
a grant on, everything beneath those, and the ancestors in between marked
`context: true`.

**Example (workspace owner):**
```json
[
  { "id": "root", "parentId": null, "kind": "group", "type": "application", "resourceId": null, "name": "Application", "ownerId": null, "workspaceId": null, "path": "/root", "depth": 0, "context": true, "owned": false },
  { "id": "n1", "parentId": "root", "kind": "group", "type": "workspace", "resourceId": "w1", "name": "Acme", "ownerId": "u2", "workspaceId": "w1", "path": "/root/n1", "depth": 1, "context": false, "owned": true },
  { "id": "n2", "parentId": "n1", "kind": "group", "type": "group", "resourceId": null, "name": "Production", "ownerId": null, "workspaceId": "w1", "path": "/root/n1/n2", "depth": 2, "context": false, "owned": false, "memberCount": 4, "canOrganise": true },
  { "id": "n3", "parentId": "n2", "kind": "resource", "type": "connection", "resourceId": "c1", "name": "prod-db", "ownerId": "u2", "workspaceId": "w1", "path": "/root/n1/n2/n3", "depth": 3, "context": false, "owned": true, "canOrganise": true, "canOpen": true }
]
```

### GET `/api/resource-tree/catalog`

What the tree is made of, and where each role may be granted — criteria already
applied.

**Sample URL:** `http://localhost:3000/api/resource-tree/catalog`

**Response:** `{ nodeTypes: [{ type, kind, label, description, children, custom?, mirrors?, singleton? }], roles: [{ slug, name, description, builtin, permissions, appliesTo, grantableOn }] }`

```json
{
  "nodeTypes": [
    { "type": "workspace", "kind": "group", "label": "Workspace", "description": "One tenant: its groups, its connections and its storage.", "children": ["group", "connection", "storage"], "mirrors": "workspaces" }
  ],
  "roles": [
    { "slug": "owner", "name": "Owner", "builtin": true, "permissions": ["workspace.manage", "…"], "appliesTo": ["application", "workspace"], "grantableOn": ["application", "workspace"] },
    { "slug": "member", "name": "Member", "builtin": true, "permissions": [], "appliesTo": null, "grantableOn": ["application", "workspace", "group", "connection", "storage", "dashboard", "workflow"] }
  ]
}
```

### GET `/api/resource-tree/:id`

One node in full: where it sits, what's in it, who has been granted what, and what
the caller themselves may do here. Seeing the node at all is the permission.

**Scoped to the caller.** `ancestors` and `children` are filtered to nodes the
caller can already see in `GET /api/resource-tree` — `childrenOf` is the raw
hierarchy, and at the application root that is *every workspace on the instance*,
which any caller reaches because the root is an ancestor of everything they hold.

**`context: true`** means the caller holds nothing on this node itself; it is in
the tree only so what they *do* hold has a path back to the root. Grants come back
`[]` and `members` is omitted in that case — who else can reach a node you hold
nothing on is not yours to read. The application root is `context` for everyone
except an instance admin, who owns it.

**Sample URL:** `http://localhost:3000/api/resource-tree/n_42`

**Response:**

```json
{
  "node": { "id": "n_42", "type": "group", "kind": "group", "name": "Production", "...": "..." },
  "context": false,
  "ancestors": [ { "id": "root", "type": "application", "name": "Application", "...": "..." } ],
  "children": [ { "id": "n_43", "type": "connection", "name": "Billing DB", "...": "..." } ],
  "grants": [ { "id": "g_1", "principalType": "node", "principalId": "n_9", "principalName": "Ops", "roleSlug": "analyst", "inherit": true } ],
  "members": [ { "userId": "u_7", "email": "sam@example.com", "name": "Sam", "createdAt": 1730000000000 } ],
  "people": [
    {
      "userId": "u_7",
      "name": "Sam",
      "email": "sam@example.com",
      "owner": false,
      "member": true,
      "permissions": ["connections.read"],
      "sources": [
        { "type": "group", "grantId": "g_1", "nodeId": "n_42", "nodeName": "Production", "groupId": "n_9", "groupName": "Ops", "roleSlug": "analyst", "roleName": "Analyst", "here": true, "instanceWide": false }
      ]
    }
  ],
  "permissions": ["resources.organise", "resources.grant"],
  "owner": { "id": "u_3", "email": "ada@example.com", "name": "Ada", "role": "user" }
}
```

`members` is present only for a group node the caller is not in `context` at.

**`grants` vs `people`.** `grants` is what was granted *on this node*; `people`
resolves the whole chain — inherited grants from above, the rosters of granted
groups, and the owner of any ancestor — so access the node itself never mentions
cannot hide. Each `source` says where its access comes from, and names the
`grantId` behind it so a caller standing on the granting node can revoke exactly
that grant (a person can hold the same role twice, through two grants). An
`owner` source carries no `grantId`: ownership is a column on the node, not a
grant. `here: true` means the grant lives on this node and is revocable from it;
otherwise `nodeId`/`nodeName` say where it does live.

The two lists don't imply one another in either direction. A grant to a group
with an empty roster appears in `grants` and reaches nobody in `people`; a person
reaching this node through a grant three levels up appears in `people` with no
row in `grants` at all.

### POST `/api/resource-tree/:id/groups`

Create a group under `:id`. Requires `resources.organise` **at that node**.
Groups are the only node type created by hand — everything else appears because
its resource was created.

**Sample URL:** `http://localhost:3000/api/resource-tree/n1/groups`

**Body:** `{ "name": "Production", "ownerId": "u3" }` (`ownerId` optional)

Omitting `ownerId` makes **the caller the owner, but only when they already own
the parent** — where ownership is theirs by cascade anyway, so recording it grants
nothing new. A caller who merely holds `resources.organise` gets an ownerless
group: otherwise that permission alone would be enough to create a group they own
and move a connection into it, inheriting every permission on that connection.

**Response:** the created Node. `400` if the parent's type cannot hold a group.

### PUT `/api/resource-tree/:id`

Rename a node. Requires `resources.organise`. **Only custom groups** — a mirrored
node follows its own resource, so this is `400` for a workspace/connection/etc.

**Body:** `{ "name": "Staging" }` → the updated Node.

### PUT `/api/resource-tree/:id/move`

Re-file a node under a different group. Requires `resources.organise` at **both**
ends — otherwise moving something into a group you control would be a way to
grant yourself access to it.

**Sample URL:** `http://localhost:3000/api/resource-tree/n3/move`

**Body:** `{ "parentId": "n2" }` → the updated Node.

`400` if the target cannot hold this type, or if the target is inside the node
being moved.

The whole subtree moves with the node, and its `path`/`depth`/`workspaceId` are
rewritten in one pass. Nothing about *who* has access is copied or rewritten: a
grant is made on a node, so the node simply starts inheriting what its new parent
carries and stops inheriting the old one's.

Both ends are resolved for the client by `canOrganise` on `GET /api/resource-tree`
— the destination picker offers only nodes whose type may hold this one (per
`GET /api/resource-tree/catalog`'s `children`) and greys out the ones the caller
cannot file into.

### PUT `/api/resource-tree/:id/owner`

Hand a node over. Ownership cascades, so only the **current owner** (or an
instance admin) may call this.

**Sample URL:** `http://localhost:3000/api/resource-tree/n1/owner`

**Body:** `{ "ownerId": "u5" }` — or `{ "ownerId": null }` to clear it.

**Response:** the updated Node.

`400` if the new owner is not a member of the node's workspace, or is an instance
admin being made owner of anything below the application root.

### DELETE `/api/resource-tree/:id`

Delete a custom group. Requires `resources.organise`. **The group must be empty** —
move or delete everything inside it first; nothing is ever silently re-filed.
`400` for a mirrored node (delete the resource itself; its node goes with it).

**Response:** `{ "ok": true }`

**`409`** when the group still holds something, with what is in the way:

```json
{
  "error": "Move or delete the 2 items inside this group first.",
  "children": [
    { "id": "n7", "name": "Billing DB", "type": "connection" },
    { "id": "n8", "name": "Archive", "type": "group" }
  ]
}
```

### GET `/api/resource-tree/:id/grants`

The grants made on this node. Same visibility rule as `GET /:id`.

**Response:** `Grant[]`

### POST `/api/resource-tree/:id/grants`

Give a person or group a role here. Requires `resources.grant` at that node.

**Sample URL:** `http://localhost:3000/api/resource-tree/n2/grants`

**Body:**

| Field | Type | Description |
| --- | --- | --- |
| `principalType` | `"user"` \| `"node"` | Who the grant is for |
| `principalId` | string | User id, or the id of a group node — the grant then reaches everyone on its roster |

**`400` when the user isn't a member of the node's workspace.** Membership is the
authority on who belongs to a workspace and is what gates opening a database, so
granting a non-member would leave them half in: resolving to permissions through
the tree while `memberRole()` returns null, meaning `requireMember` and
`userCanAccessConnection` both still refuse them. The group-roster route and
`PUT /api/connections/:id/owner` already applied this rule; grants were the one
path that skipped it. A grant made on the **application root** has no workspace,
so it is exempt — that is the one way someone reaches a workspace node without
being a member of it, and the access view marks it.
| `roleSlug` | string | A slug from the role catalog |
| `inherit` | boolean | Default `true` — applies to the whole subtree; `false` = this node only |

```json
{ "principalType": "user", "principalId": "u4", "roleSlug": "member", "inherit": true }
```

**Response:** the created Grant. Re-granting the same `(node, principal, role)`
updates `inherit` rather than duplicating.

`400` with a specific reason when the requirement criteria refuse it:

```json
{ "error": "Owner can only be granted on: application, workspace." }
```

### DELETE `/api/resource-tree/:id/grants/:grantId`

Revoke a grant. Requires `resources.grant`.

**Response:** `{ "ok": true }`

### Nodes follow their resources

A node is created, renamed and deleted alongside the row it mirrors — never on
its own. `POST /api/connections` accepts an optional `parentNodeId` to file the
new connection straight into a group instead of at the workspace root. Removing
someone from a workspace revokes every grant they held anywhere in its subtree
and clears any node ownership inside it.

---

## Roles & permissions (auth required)

Workspace access is an **instance-wide role catalog**: an instance admin defines
what each role may do, and a workspace owner assigns their people to it. A
membership (the grant on the workspace's node) stores a role **slug**, and every
workspace-scoped route authorizes by *permission*, never by role name — so
redefining a role changes who may call a route without touching the route.

The account's *system* role (`admin` | `user`) is **not** part of this model and
is not configurable. Instance administration deliberately carries no workspace
data access; making the system tier editable would only be a way around that.

**Permission keys** (the closed set, from `server/permissions-catalog.js`):

`scope` is the shallowest node type the key means anything at — the criterion
that decides where a role carrying it may be granted (see Resource tree).

| Key | Scope | Allows |
| --- | --- | --- |
| `workspace.manage` | workspace | Rename the workspace; change general settings, experiments and the session policy. Also the anchor of the last-owner rule — "owner" means *holds this*. |
| `workspace.delete` | workspace | `DELETE /api/workspaces/:id`. |
| `members.manage` | workspace | Invite, remove, and change a member's role. |
| `teams.manage` | workspace | Change who belongs to a group. Key unchanged when teams became groups (v15) — `role_permissions` stores these strings and drops unknown ones, so renaming it would silently strip the power from every role holding it. Deliberately not `resources.organise`: adding someone to a group grants them access, tidying the tree must not. Old text: create/rename/delete teams and change their membership. |
| `notifications.manage` | workspace | The `notifications` block on `PUT /api/workspaces/:id`. |
| `storage.manage` | workspace | Create/edit/delete storage destinations. |
| `connections.create` | workspace | `POST /api/connections` and `POST /api/connections/import`. |
| `connections.manage` | connection | Edit/delete/export/set access on every connection in scope — the whole workspace, or one connection when granted on its node. |
| `connections.transfer` | connection | `PUT /api/connections/:id/owner`. |
| `resources.organise` | workspace | Create, rename, move and delete the groups resources are filed under. |
| `resources.grant` | workspace | Give a person or group a role on a node, and take it away again. |

Deliberately absent: *using* a database (queries, row edits, workflows,
dashboards, schema changes) is not a permission. That is a per-resource grant on
the connection itself (`connection_access` — see Connection access), because it
answers a per-connection question, not a workspace-wide one.

Two seeded built-in roles, `owner` (every permission) and `member` (none). Their
slugs match the literals a membership held before roles became
configurable, so meta migration v12 rewrote nothing. A built-in can be renamed and
re-permissioned but never deleted, and `owner` always keeps `workspace.manage`.

A failed workspace-tier check returns
`403 { "error": "You do not have permission to do that.", "permission": "<key>" }`
when the caller is in the workspace, and `403 { "error": "Forbidden" }` when they
aren't — so a client can tell "ask an owner" from "wrong workspace".

- `GET /api/roles` → `[{ id, slug, name, description, builtin, permissions, appliesTo, grantableOn, memberCount, grantCount, createdAt, updatedAt }]`.
  Readable by **any signed-in user**: assigning a member a role needs the names,
  and the UI explains what each grants. Built-ins first, then alphabetical.
  `memberCount` is how many memberships hold the role and `grantCount` how many
  tree grants do (two grouped queries, not one per role) — together they are who
  an edit affects, and whether a delete will be refused. `appliesTo` is the
  admin-set node-type restriction (null = anywhere) and `grantableOn` is where the
  role may actually be granted once every criterion is applied. The write
  endpoints below return the role **without** the counts.
- **Example:** `GET http://localhost:3000/api/roles`

### Managing roles (`/api/admin/*`, system admin only)

> **API-only today — there is no Roles screen.** The app assigns roles (the
> member dropdowns read `GET /api/roles`) but does not create them, so an
> instance ships with the two seeded builtins unless an admin adds more through
> these endpoints. They are fully enforced either way; the UI is what's missing.

- `GET /api/admin/permissions` → the catalog grouped for a role editor:
  `[{ group, items: [{ key, label, description, scope }] }]`. It comes from the
  server's **code**, not its database, so a UI can only ever offer a permission
  some route actually enforces. `scope` is where the key means anything.
- `POST /api/admin/roles` `{ name, description?, permissions?, appliesTo? }` → the
  created role. The slug is derived from the name (`"Data Analyst"` →
  `data-analyst`, suffixed `-2`, `-3` … if taken) and is **fixed for the life of
  the role**, because memberships store it. Unknown permission keys and unknown
  node types are dropped silently. `appliesTo` restricts which node types the role
  may be granted on; omit it (or send `null`) for "anywhere". `400` when `name` is
  empty.
- `PUT /api/admin/roles/:slug` `{ name?, description?, permissions?, appliesTo? }` →
  the updated role. Omitting `permissions` leaves the grants alone; sending it
  **replaces** them wholesale (not a partial patch). `appliesTo` is three-valued:
  absent leaves the criteria alone, `null` widens them to any node type, an array
  narrows them — and narrowing decides only what may be granted *next*, it never
  revokes a grant someone already holds. Renaming never touches a membership row.
  Editing `owner` always keeps `workspace.manage`, whatever the body says.
  `404` for an unknown slug.
- `DELETE /api/admin/roles/:slug` → `{ ok: true }`.
  `400` for a built-in; `409 { error, inUse }` while any membership **or tree
  grant** still holds the role — those people would otherwise fail closed to no
  access, so move them first.
- **Example:** `POST http://localhost:3000/api/admin/roles` body
  `{ "name": "Data Analyst", "description": "Builds connections, runs queries", "permissions": ["connections.create"], "appliesTo": ["workspace", "group"] }`

---

## Workspaces (auth required)

- `GET /api/workspaces` → `[{ id, name, role, permissions, createdAt, experiments, notifications }]`
  the caller belongs to. `role` is a **role slug** from the instance's catalog and
  `permissions` is what that role grants here (see Roles & permissions below) —
  ships on the list route, not just the detail one, so permission-gated nav
  doesn't flicker while the detail request is in flight. **Don't branch on the
  slug**: ask `permissions`. `experiments` is `{ [key]: boolean }` (see Beta experiments
  below) — included for every member, not just admins, since it gates what the
  whole workspace sees. `notifications` ships here too (not just the detail route)
  so a settings panel that only calls `refresh()`/`listWorkspaces()` after saving
  sees the persisted value instead of it reverting to empty.
- `POST /api/workspaces` `{ name }` → creates one; caller becomes `owner`.
  An instance admin gets `403` here (they cannot own a workspace) — they use
  `POST /api/admin/workspaces`, which names someone else as the owner.
- `GET /api/workspaces/:id` → `{ id, name, role, permissions, createdAt, experiments, notifications, sessions }`;
  `sessions` is `{ maxPerConnection, instanceDefault }` — the workspace-wide cap on
  concurrent sessions per connection (0 = unlimited) plus the read-only
  `MAX_SESSIONS_PER_CONNECTION` env fallback that applies while it's 0, so the
  settings form can show what's actually in effect. See "Connection sessions".
  Owners also get `smtp` — the instance's mail server, **read-only**:
  `{ source: 'global' | 'env', host, port, secure, user, from }`, or `null` when
  the instance has none. `source` is `global` for the config an instance admin
  saved (`/api/admin/smtp`) and `env` for the `SMTP_*` vars under it. Non-secret
  fields only — no password ever leaves the server. A workspace **cannot**
  configure its own SMTP (removed in meta migration v10); this field exists so
  the Notification tab can say what will send, or that nothing will.
- `PUT /api/workspaces/:id` `{ name?, experiments?, notifications?, sessions? }` → `{ ok: true }`.
  Checked **field by field**, not once for the whole route: `name`/`experiments`/
  `sessions` need `workspace.manage`, `notifications` needs
  `notifications.manage`, so a role can be trusted with one and not the other.
  `sessions` is `{ maxPerConnection }` (integer, 0 = unlimited; negatives and junk
  clamp to 0) — the cap every connection in the workspace is held to. It is the
  only place this is configurable: there is no per-connection override.
  There is no `smtp` here — the mail server is instance-level, set at
  `PUT /api/admin/smtp`; an older client still sending one is ignored, not
  rejected. `experiments` is a partial `{ [key]: boolean }`, merged onto the
  existing flags (so toggling one doesn't clear the others). `notifications` is
  `{ backupFailure?: { enabled, memberIds } }` — `backupFailure`, if present, fully
  replaces the stored value (send the complete object, not a partial patch).
- **Beta experiments:** a per-workspace `{ [key]: boolean }` map stored in
  `workspaces.settings.experiments`, surfaced via the two routes above and
  toggled from the frontend's Workspace → Beta tab. Current keys: `s3Backup`
  (gates the S3 Storage nav item and each connection's Backup tab — see the
  Storage destinations / Backup sections below).
- **Notifications:** `workspaces.settings.notifications.backupFailure` is
  `{ enabled: boolean, memberIds: string[] }`, surfaced via the two routes above
  and edited from the frontend's Notification tab. When enabled, a scheduled backup
  that ends up failed (after any configured retries — see the Backup section) emails
  every listed member via the instance's SMTP config (see `smtpConfig`). Manual
  "Run now" failures never trigger this.
- `DELETE /api/workspaces/:id` (`workspace.delete`) → deletes it + its connections/queries.
  `400` if it's the caller's only workspace. Live driver handles for its
  connections are released and their sessions ended before the cascade runs.

### Members
All three mutations need `members.manage`.
- `GET /api/workspaces/:id/members` → `[{ userId, email, name, role, permissions, isOwner, status, systemRole, createdAt }]`.
  `role` is the role slug; `permissions` is what it grants and `isOwner` whether
  that includes `workspace.manage` — both resolved server-side so a client never
  has to interpret a slug. `systemRole` is the account's system role, so the UI
  can tell an instance admin apart.
- `POST /api/workspaces/:id/members` `{ email, role? }` → `{ member, inviteLink, emailed }`.
  `role` defaults to `member` and must be a slug in the catalog (`400` otherwise) —
  invite straight into a role instead of adding then promoting. Existing accounts
  are added directly; otherwise a pending user + invite link is created (and
  emailed when SMTP is configured; `inviteLink` returned regardless). `400` if the
  email belongs to an instance admin — such an account cannot join a workspace.
- `PUT /api/workspaces/:id/members/:userId` `{ role }` → `{ ok: true, role }`.
  Moves the member to any role in the catalog. `400` for an unknown slug, when the
  target is an instance admin, or when this would move the **last** member holding
  `workspace.manage` to a role that doesn't ("The workspace needs at least one
  owner.") — the check is on the permission, so a custom role granting
  `workspace.manage` satisfies it too.
- `DELETE /api/workspaces/:id/members/:userId` → `{ ok: true }`. Can't
  remove yourself or the last owner. Also drops the removed user from every group
  in this workspace, from any individual connection grants, and from ownership of
  any node inside it.
- **Example:** `PUT http://localhost:3000/api/workspaces/ws_123/members/u_456` body `{ "role": "owner" }`.

### Workspace membership

A workspace's members live in `node_members` on the workspace's own node — the
same roster table every group uses (meta migration v16 moved them; the old
`workspace_members` table is kept, unread, for rollback). Two facts sit on that
node:

| Fact | Where | Means |
| --- | --- | --- |
| Belonging | `node_members` row | They are in the workspace, and **see every resource in it** |
| Role | the user grant on that node | What they may actually **do** |

So a member holding no grant is a real, useful state: the whole workspace is
visible to them and they can act on none of it. `isMember()` answers belonging;
`memberRole()` reads the grant and returns `null` for a member without one — use
`isMember` for "do they belong", never `memberRole` truthiness.

The roster routes above work on a workspace node too, with two differences the
server applies by node type:

- the permission is **`members.manage`**, not `teams.manage` — admitting someone
  to the workspace and staffing a folder are different powers;
- adding goes through the workspace module (roster + membership grant written
  together), removing runs the full member cascade and refuses to drop the last
  owner or yourself. An instance admin can never be added.

The UI keeps invitations on the workspace's Members page rather than here, since
joining a workspace needs an email and an invite token.

### Who can reach a node

`GET /api/resource-tree/:id` carries a `people` array: everyone who can reach that
node, resolved up the whole chain, and **why**.

This is not the same as `grants`. That field is what was granted *at* this node,
so on a connection it will not show the people arriving through an inherited grant
higher up, the people arriving because they are on the roster of a group granted
somewhere above, or the owner of an ancestor who short-circuits to everything.
Access a node never mentions is what makes a permission model impossible to audit,
so it is derived and returned. It is stored nowhere — the grants and rosters it
reads are the only facts, and access is still edited where the grant lives.

```json
{
  "userId": "u_7", "name": "Dana Reyes", "email": "dana@example.com",
  "owner": false,
  "member": true,
  "permissions": ["connections.manage"],
  "sources": [
    { "type": "group", "nodeId": "n_1", "nodeName": "Main", "groupId": "n_9",
      "groupName": "Analytics", "roleSlug": "analyst", "roleName": "Analyst",
      "here": false, "instanceWide": false }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `owner` | Owns this node or an ancestor, so resolves to every permission below it |
| `member` | `false` = permissions but **no data access**: opening a database needs a roster row on the workspace node |
| `sources[].type` | `"owner"` \| `"grant"` (a user grant) \| `"group"` (via a roster) |
| `sources[].here` | Granted on this very node rather than inherited from above |
| `sources[].instanceWide` | Granted above every workspace (the application root), so it reaches in without a membership |

Every path is listed, not just the first — two ways into a node are two different
things to revoke. Instance admins are deliberately absent: they administer every
node without holding a grant, and hold no data access at all.

Blanked (`[]`) for a scaffolding node, the same as `grants`.

At a **workspace** node this list equals the workspace's member list, because
`server/workspaces.js` mirrors every membership into a grant there and a grant to a
non-member is refused. The only rows that can differ are application-root grants,
flagged `instanceWide`.

### Groups (people)
A group node is both a folder resources are filed under **and** a named set of
people, so there is no separate teams API: the roster lives on the node, next to
the grants made there. See "Resource tree" above for creating, renaming, moving
and deleting the group itself.

Reading the roster needs only to be able to see the node; changing it needs
`teams.manage` — **not** `resources.organise`. Adding someone to a group grants
them access (every grant naming that group reaches them, and none of it shows on
the grant list of the node they just reached), so tidying the tree deliberately
does not carry that power.

- `GET /api/resource-tree/:id/members` → `[{ userId, email, name, createdAt }]`.
  `400` if the node is not a group.
- `POST /api/resource-tree/:id/members` `{ userId }` → `{ ok: true }`.
  `400` if the user isn't a member of the group's workspace — a group scopes
  access inside one workspace, so its roster can't reach outside it.
- `DELETE /api/resource-tree/:id/members/:userId` → `{ ok: true }`.
- **Example:** `POST http://localhost:3000/api/resource-tree/n_42/members` body `{ "userId": "u_456" }`.

Deleting a group takes its roster with it, plus every grant and access row that
named it as a principal — a grant whose roster no longer exists would otherwise
be stranded.

> Migrated from `teams`/`team_members` by meta migration v15. The old tables are
> kept but never read; the old `/api/workspaces/:id/teams*` routes are gone.

---

## Instance administration (`/api/admin/*`, system admin only)

Every route below requires an account whose **system** role is `admin`; anything
else gets `403 { "error": "Admin access required" }`. The surface is deliberately
narrow — which workspaces exist and who runs them, plus the accounts on the
instance. An instance admin holds no workspace membership, so there is no route
here that reaches a connection or a database.

### Workspaces

- `GET /api/admin/workspaces` → `[{ id, name, createdAt, memberCount, groupCount, connectionCount, owners }]`
  for **every** workspace on the instance. `owners` is the member objects whose
  role carries `workspace.manage` — an empty array means the workspace is
  currently ownerless
  (its owners left, or it was just created), which is the state an admin acts on.
- `POST /api/admin/workspaces` `{ name, ownerEmail }` → `{ workspace, inviteLink, emailed }`.
  Creates the workspace and hands it to `ownerEmail`. An unknown address gets a
  pending account plus an `inviteLink` (emailed when SMTP is configured; returned
  either way). `400` if `ownerEmail` belongs to an instance admin.
- `PUT /api/admin/workspaces/:id` `{ name }` → `{ ok: true, name }`.
- `DELETE /api/admin/workspaces/:id` → `{ ok: true, connectionsDeleted }`. Releases
  the live driver handles and ends the sessions first, then cascades the metadata
  (connections, queries, folders, workflows, dashboards, history, groups, storage
  destinations).
- `GET /api/admin/workspaces/:id/members` → `[{ userId, email, name, role, permissions, isOwner, status, systemRole, createdAt }]`.
- `PUT /api/admin/workspaces/:id/members/:userId` `{ role }` → `{ ok: true, role }`.
  `role` is any slug from the catalog (`400` otherwise). Adds the user to the
  workspace if they aren't in it yet — this is how an admin rescues a workspace
  whose owners have all left.
  `400` when demoting the last owner, or when the target is an instance admin.
- `DELETE /api/admin/workspaces/:id/members/:userId` → `{ ok: true }`. `400` when
  it would remove the last owner.
- **Example:** `POST http://localhost:3000/api/admin/workspaces` body
  `{ "name": "Engineering", "ownerEmail": "olive@example.com" }`.

### Users

- `GET /api/admin/users` → `[{ id, email, name, role, status, blocked, blockedAt,
  blockedUntil, failedAttempts, workspaces }]` where `workspaces` is
  `[{ id, name, role }]` — what the account would lose if promoted. `status` is the
  invite lifecycle (`active` | `pending`); `blocked` is the brute-force guard and
  is independent of it (`blockedUntil: null` = only an admin can lift it).
- `POST /api/admin/users` `{ email, name?, password?, role? }` → `{ user, inviteLink }`.
  With `password` the account is active immediately; without it the account is
  `pending` and `inviteLink` is how they set one. `role` is `admin` | `user`
  (default `user`). `400` if the email already has an account.
- `PUT /api/admin/users/:id` `{ name?, password?, role? }` → the updated user.
  Changing `password` or `role` signs the account out everywhere.
  - `409` when promoting an account to `admin` that is the **only** owner of a
    workspace — promotion strips every membership, so it would orphan it. The body
    carries `workspaces: [{ id, name }]`; reassign ownership first.
  - `400` when demoting the last instance admin.
- `POST /api/admin/users/:id/unblock` → the updated user. Lifts a brute-force
  block and clears the failed-attempt counter; a no-op on an account that isn't
  blocked. `404` when the user doesn't exist.
- `DELETE /api/admin/users/:id` → `{ ok: true }`. `400` for your own account or the
  last instance admin; `409` (same shape as above) when the account is the only
  owner of a workspace. The cascade drops every membership, then releases any
  resource-tree node the account still owned and every grant it held **instance-wide** —
  memberships only reach the workspaces they were memberships *of*, so a node owned
  in a workspace the account had already left would otherwise keep a dangling owner.
  The nodes themselves survive; they become ownerless, and a parent node's owner
  can reassign them.
- **Example:** `PUT http://localhost:3000/api/admin/users/u_123` body `{ "role": "admin" }`.
- **Example:** `POST http://localhost:3000/api/admin/users/u_123/unblock`.

### Email (SMTP)

The instance's **one** mail server — every email the app sends (invites,
password resets, backup-failure notifications) uses it, for every workspace.
Workspaces cannot configure their own; these routes are the only place SMTP is
set. **Resolution order:** this saved config → the `SMTP_*` env vars. The env
vars still work untouched (an install configured through docker-compose keeps
sending mail); saving here takes over from them, and can be changed without a
redeploy. Stored in the meta DB's `app_settings` table under the key `smtp`,
with the password AES-256-GCM encrypted at rest — it is never returned.

- `GET /api/admin/smtp` → `{ smtp, env }`.
  `smtp` is the saved config, password-masked:
  `{ host, port, secure, user, from, hasPassword }` — `host: ""` means nothing
  is saved. `env` is the non-secret env layer under it
  (`{ host, port, secure, user, from }`) or `null` when `SMTP_HOST` is unset;
  the admin form pre-fills from it.
- `PUT /api/admin/smtp` `{ host?, port?, secure?, user?, from?, pass? }` →
  `{ smtp }` (the saved, masked config). Fields left out keep their stored
  value. Omit `pass` (or send `""`) to keep the stored password; send `null` to
  clear it. Saving `host: ""` disables the saved config — the instance falls
  back to `env`.
- `DELETE /api/admin/smtp` → `{ ok: true, smtp }`. Drops the saved config
  entirely; the instance falls back to the `SMTP_*` env vars, or to sending no
  mail at all (invites still return a copyable link).
- `POST /api/admin/smtp/test` `{ to?, smtp? }` → `{ ok: true }` or
  `400 { error }`. `to` defaults to the caller's own email. `smtp` (same shape
  as `PUT`; a blank `pass` reuses the stored one) tests unsaved form values;
  omit it to test what is in effect instance-wide right now. TLS-mismatch errors
  are translated into a readable hint instead of the raw OpenSSL text.
- **Example:** `PUT http://localhost:3000/api/admin/smtp` body
  `{ "host": "smtp.example.com", "port": 587, "secure": false, "user": "apikey", "pass": "s3cret", "from": "Tabletsgo <no-reply@example.com>" }`.

---

## Connections

### GET `/api/connections`
List connections in a workspace the caller belongs to. Results are further filtered
by **connection access** (see below): a connection with no access rows is visible to
every workspace member; one with access rows is visible only to workspace owners, its
assigned individual members, and everyone in its assigned groups.
- **Query:** `workspace` (required — the workspace id). Missing → `[]`.

- **200:** `Connection[]` (array of connection objects)
- **Example:** `GET http://localhost:3000/api/connections`

### POST `/api/test-connection`
Test connectivity without saving. Body is a connection-shaped object.

- **Body (SQLite):** `{ "type": "sqlite", "filepath": "./demo.db" }`
- **Body (PostgreSQL):** `{ "type": "postgresql", "host": "...", "port": 5432, "username": "...", "password": "...", "database": "...", "sslmode": "disable" }`
- **Body (Redis):** `{ "type": "redis", "host": "...", "port": 6379, "username": "...", "password": "...", "database": "0", "tls": "require" }` — or `{ "type": "redis", "uri": "redis://user:pass@host:6379/0" }`
- **200 (success):** `{ "ok": true, "message": "Connected! 5 table(s) found." }`
  (Redis: `{ "ok": true, "message": "Connected to Redis 7.4.2 · 128 key(s) in db0." }`)
- **200 (failure):** `{ "ok": false, "message": "<driver error>" }` (note: failures still return HTTP 200)
- **400:** `{ "ok": false, "message": "Unsupported connection type: mysql" }`
- **Example:** `POST http://localhost:3000/api/test-connection`

> **Who may change a connection record.** `PUT`, `DELETE`, `/export` and
> `/access` all use one rule: hold **`connections.manage`** (any connection in the
> workspace) *or* be the connection's own **`ownerId`** (that one connection,
> whatever your role). That is what lets a plain member run the connections they
> own — edit them, back them up, set their access list — without being given the
> whole workspace. Failing it returns
> `403 { "error": "You need to own this connection to <action>." }`.
> Using the *database* behind a connection is a different question entirely — see
> Connection access.

### POST `/api/connections`
Create a connection (**`connections.create`**). Server assigns the `id` (UUID). The
`ownerId` defaults to the authenticated caller unless one is supplied in the body.
The response includes the resolved `ownerName` / `ownerEmail`.

- **Body:** connection object **without** `id` (see Data models); `ownerId` optional
- **200:** the created connection (with `id`, `ownerId`, `ownerName`, `ownerEmail`)
- **403:** `{ "error": "You do not have permission to do that.", "permission": "connections.create" }`
- **Example:** `POST http://localhost:3000/api/connections`

### PUT `/api/connections/:id`
Update a connection (manage-or-own, see above). Merges body into the existing
record; drops cached pools/handles so the next query reconnects with new settings.

- **Body:** partial or full connection fields to change
- **200:** the updated connection
- **404:** `{ "error": "Connection not found" }`
- **Example:** `PUT http://localhost:3000/api/connections/demo-sqlite`

### PUT `/api/connections/:id/owner`
Hand the connection to another member of the workspace (**`connections.transfer`**).

Its own permission rather than part of `connections.manage`, because it is the one
change that can take a connection *away* from the caller: the new owner may edit,
back up and delete it, and the previous owner keeps that only if their role does.

- **Body:** `{ "ownerId": "user_456" }`
- **200:** the updated connection (with the new `ownerId` / `ownerName` / `ownerEmail`)
- **400:** `{ "error": "That person is not a member of this workspace." }` —
  ownership is not a way to grant workspace access. Also `400` if the target is an
  instance admin (they hold no membership at all), or if the connection has no
  `workspaceId`.
- **403:** `{ "error": "You do not have permission to do that.", "permission": "connections.transfer" }`
- **404:** `{ "error": "Connection not found" }`
- **Example:** `PUT http://localhost:3000/api/connections/demo-sqlite/owner` body `{ "ownerId": "user_456" }`

### DELETE `/api/connections/:id`
Delete a connection and cascade-delete its saved queries, folders (including
table-folder membership), workflows, dashboards and history.
Also closes any open pool/handle.

- **200:** `{ "ok": true }`
- **404:** `{ "error": "Connection not found" }`
- **Example:** `DELETE http://localhost:3000/api/connections/demo-sqlite`

### Connection export / import
Moves a whole connection — its settings **and** every artifact hanging off it — as
one portable JSON document. Included: connection settings, folders (all four types,
with their tree + colors), table→folder assignments, saved queries, workflows,
dashboards and the backup schedule. Deliberately **excluded**: history/audit rows
(query history, workflow runs, backup runs, schema migrations) and connection access
grants — they describe one instance, not the connection's configuration.

The document is dialect-agnostic: connection settings ride along as an opaque
`connection.settings` object, so a new database type needs no change here.

#### GET `/api/connections/:id/export`
Build the export document for a connection.

- **Query:** `secrets` (optional — `1`/`true`/`yes` keeps the stored password; default
  omits every secret field and blanks a password embedded in a `uri`)
- **200:**
```json
{
  "kind": "connection",
  "version": 1,
  "exportedAt": 1785227173000,
  "app": { "name": "tabletsgo", "version": "0.19.0" },
  "includesSecrets": false,
  "connection": {
    "type": "postgresql",
    "name": "Demo",
    "environment": "local",
    "folder": "",
    "tags": ["analytics"],
    "settings": { "host": "localhost", "port": 5432, "username": "app", "database": "demo", "sslmode": "disable" }
  },
  "folders": [{ "id": "f1", "type": "table", "name": "Core", "color": "#6366f1", "parentId": null, "ts": 1785227173134 }],
  "tableFolders": [{ "tableName": "users", "folderId": "f1" }],
  "savedQueries": [{ "id": "q1", "name": "All rows", "sql": "SELECT 1", "kind": "query", "folderId": null, "ts": 1785227173232 }],
  "workflows": [{ "id": "w1", "name": "Nightly", "graph": { "nodes": [], "edges": [] }, "folderId": null, "scheduleEnabled": true, "ts": 1785227173259 }],
  "dashboards": [{ "id": "d1", "name": "Overview", "config": { "variables": [], "widgets": [] }, "folderId": null, "ts": 1785227173300 }],
  "backupSchedule": { "frequency": "daily", "hourOfDay": 2, "destinationIds": ["local"], "retryLimit": 0, "retryDelaySec": 60, "retentionDays": 7, "encrypt": false, "enabled": true }
}
```
- **404:** `{ "error": "Connection not found" }`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/export?secrets=1`

Webhook tokens are stripped from workflow graphs — they're secrets and never
round-trip through a file (import mints fresh ones).

#### POST `/api/connections/import`
Create a **new** connection from an export document, in one transaction (a rejected
document leaves nothing behind). Caller must be a member of the target workspace.
Mounted above the `/api/connections/:id` guard, so `import` is never read as an id.

Every artifact gets a fresh id: the folder tree is re-parented onto the new ids
(a cycle or an over-deep branch is imported at the root), items keep their folder
when the folder groups that kind of item, and dashboard row actions are re-pointed
at the newly created workflow ids. Storage destinations are workspace-scoped and are
**not** part of the bundle — references this workspace doesn't have are dropped, and
schedules (workflow + backup) arrive **paused**.

- **Body:**
```json
{
  "workspaceId": "ws_1",
  "document": { "kind": "connection", "version": 1, "...": "the export document" },
  "name": "Demo (imported)",
  "settings": { "password": "typed-in-by-the-importer" }
}
```
  `name` (optional) overrides the connection name; `settings` (optional) overrides
  individual credential fields — e.g. a password the export left out, or SQLite's
  `filepath` on this host.
- **200:**
```json
{
  "connection": { "id": "new-uuid", "type": "sqlite", "name": "Demo (imported)", "...": "full connection object" },
  "counts": { "folders": 5, "tables": 1, "savedQueries": 1, "workflows": 1, "dashboards": 1 },
  "warnings": ["1 scheduled workflow(s) were imported paused — enable them once the connection is verified."]
}
```
- **400:** `{ "error": "Not a connection export file." }` / `{ "error": "This file was exported by a newer version of tabletsgo." }` / `{ "error": "The file is missing its connection settings." }`
- **403:** `{ "error": "Forbidden" }` (not a member of `workspaceId`)
- **Example:** `POST http://localhost:3000/api/connections/import`

### Connection access
Controls which groups / individual members may see and **open** a connection. This
is the per-resource grant that workspace permissions deliberately don't cover: it
answers "may this person use this database", which is a question about one
connection, not about the workspace.

**An empty set means nobody** — not everybody (changed in v16). Seeing a
connection and being able to open it are different questions: every workspace
member already sees every connection in their workspace, because their membership
grant reaches the whole subtree, and opening one is granted per connection. The
set lists users + groups; a group may be the **workspace node itself**, which
names exactly "everyone in this workspace" and is what v16 wrote for every
connection that was implicitly open, so nothing lost access on upgrade. Plus,
always, whoever holds `connections.manage` and the
connection's own `ownerId`. Enforced by the `GET /api/connections` list filter and
the `/api/connections/:id/*` access guard.

#### GET `/api/connections/:id/access`
Read the current assignment (any caller who already has access).
- **200:** `{ "groups": ["n_42"], "users": ["user_1"] }` (id arrays — `groups` holds group **node** ids; empty = open)
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/access`

#### PUT `/api/connections/:id/access`
Replace the assignment (manage-or-own, see the note above the connection routes).
Send the full desired set.
- **Body:** `{ "groups": ["n_42"], "users": ["user_1"] }` (either may be omitted → treated as `[]`)
- **200:** the stored `{ groups, users }`
- **403:** `{ "error": "You need to own this connection to change a connection's access list." }`
- **Example:** `PUT http://localhost:3000/api/connections/demo-sqlite/access`

---

## Saved queries (per connection)

### GET `/api/connections/:id/saved`
List saved queries for a connection (newest first).

- **200:** `SavedQuery[]` — each includes `folderId` (null = root) and `kind`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/saved`

### POST `/api/connections/:id/saved`
Create a saved query.

- **Body:** `{ "name": "Active users", "sql": "SELECT ...", "kind": "query" }` (`kind` optional, defaults `"query"`)
- **200:** `{ "id", "name", "sql", "kind", "ts" }`
- **400:** `{ "error": "A name and SQL are required" }`
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/saved`

### PUT `/api/connections/:id/saved/:sid`
Update fields of a saved query. Any subset of `name`, `sql`, `folderId`.
`folderId: null` moves the query back to the root.

- **Body examples:**
  - Rename: `{ "name": "New name" }`
  - Update SQL: `{ "sql": "SELECT 1" }`
  - Move to folder: `{ "folderId": "folder-uuid" }`
  - Move to root: `{ "folderId": null }`
- **200:** `{ "ok": true }`
- **400:** `{ "error": "Nothing to update" }` (or name/SQL validation messages)
- **404:** `{ "error": "Not found" }`
- **Example:** `PUT http://localhost:3000/api/connections/demo-sqlite/saved/abc-123`

### DELETE `/api/connections/:id/saved/:sid`
Delete a saved query.

- **200:** `{ "ok": true }`
- **Example:** `DELETE http://localhost:3000/api/connections/demo-sqlite/saved/abc-123`

---

## Folders (per connection)

Folders are polymorphic: one tree per resource `type`. `type=query` groups saved
queries (uncapped nesting), `type=dashboard` groups dashboards (3-level cap),
`type=workflow` groups workflows (3-level cap), `type=table` groups the connected
database's tables (3-level cap). The `type` param defaults to `query` for older
clients. Each item points back via its own `folderId` — except tables, which live
in the user's database and are mapped by name in `connection_tables` (see the
`/tables/:table/folder` endpoint below). Every folder may carry a `color`.

### GET `/api/connections/:id/folders`
List folders of a given `type` (oldest first). Folders nest via `parentId` (null = root).

- **Query:** `?type=query|dashboard|workflow|table` (defaults to `query`)
- **200:** `Folder[]` → `[{ "id", "name", "color", "parentId", "type", "ts" }]`
  (`type=table` rows also carry `"tables": ["orders", …]`)
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/folders?type=workflow`

### POST `/api/connections/:id/folders`
Create a folder. Pass `parentId` to create a subfolder under an existing folder.

- **Body:** `{ "type": "workflow", "name": "Reports", "parentId": null, "color": null }`  // `type` defaults to `query`; `parentId` (root) and `color` optional
- **200:** `{ "id", "name", "color", "parentId", "type", "ts" }` (plus `"tables": []` when `type=table`)
- **400:** `{ "error": "A folder name is required" }` / `{ "error": "Parent folder not found" }` / `{ "error": "Folders can only nest 3 levels deep" }`
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/folders`

### PUT `/api/connections/:id/folders/:fid`
Rename, recolor and/or move (reparent) a folder. Send any subset of `name`,
`color`, `parentId`. `parentId: null` moves the folder to the root; `color: null`
clears the color.

- **Body:** `{ "name": "Renamed" }` and/or `{ "color": "#ef4444" }` and/or `{ "parentId": "fld-2" }`
- **200:** `{ "ok": true }`
- **400:** `{ "error": "A folder name is required" }` / `{ "error": "Parent folder not found" }` /
  `{ "error": "Can't move a folder into its own subfolder" }` / `{ "error": "A folder can't be its own parent" }` /
  `{ "error": "Nothing to update" }`
- **404:** `{ "error": "Not found" }`
- **Example:** `PUT http://localhost:3000/api/connections/demo-sqlite/folders/fld-1`

### DELETE `/api/connections/:id/folders/:fid`
Delete a folder. Its contents move up one level (to the deleted folder's parent,
or the root for a top-level folder): child subfolders are reparented and the
folder's items (queries/dashboards/workflows/tables, per `type`) are re-attached
(`folder_id`/`parent_id` set to the parent), not deleted. For `type=table`,
items that land at the root are simply ungrouped (their mapping row is dropped).

- **200:** `{ "ok": true }`
- **Example:** `DELETE http://localhost:3000/api/connections/demo-sqlite/folders/fld-1`

---

## Table folders (per connection)

Tables are grouped by the generic folders tree above, using `type=table`. Each
table belongs to **at most one** folder; table names are plain strings, so the
contract is database-agnostic across every dialect. Folder create/list/update/
delete all go through `/api/connections/:id/folders` — the only extra endpoint is
membership:

> **Migrated from domains.** Meta migration v5 folded every domain into this tree
> (same id, name and color), so previously assigned tables keep their grouping.
> The `/api/connections/:id/domains*` endpoints are gone.

### PUT `/api/connections/:id/tables/:table/folder`
Set (or clear) which folder a table belongs to. Reassigning replaces the table's
previous folder (upsert); `folderId: null` ungroups it.

- **Body:** `{ "folderId": "fld-1" }` (or `{ "folderId": null }` to clear)
- **200:** `{ "ok": true }`
- **404:** `{ "error": "Folder not found" }`
- **Example:** `PUT http://localhost:3000/api/connections/demo-sqlite/tables/orders/folder`

---

## Query history (per connection)

Persisted log of query executions, recorded by the SQL editor.

### GET `/api/connections/:id/history`
List executions (newest first).

- **Query:** `limit` (default `500`, max `5000`)
- **200:** `QueryHistoryEntry[]` (see Data models)
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/history?limit=200`

### POST `/api/connections/:id/history`
Record one execution.

- **Body:** `{ "table": "users", "query": "SELECT ...", "status": "success", "latency": 12, "error": null, "executorId": "user-uuid", "executorName": "Admin" }`
  (`status` defaults to `"success"` unless `"failed"`; `table`/`error` nullable)
- **200:** the created entry (with `id`, `executedAt`)
- **400:** `{ "error": "A query is required" }`
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/history`

### DELETE `/api/connections/:id/history`
Clear all history for the connection.

- **200:** `{ "ok": true }`
- **Example:** `DELETE http://localhost:3000/api/connections/demo-sqlite/history`

---

## Workflows (per connection)

Node-graph automations (React Flow) run against the connection. A workflow's
`graph` is `{ nodes, edges }` in React Flow shape; each node's `type` is one of
`manual` (trigger), `schedule` (trigger), `webhook` (trigger), `query`, `http`,
`js`, `switch`, `loop`, `export`, `storage`, and its config lives in `node.data`:
- `query`: `{ sql }` — the SQL may inline scalar values from the node's input as
  `{{input.path}}` (dotted paths supported, e.g. `{{input.row.id}}`); values are
  rendered as SQL literals (strings quoted with `''` doubling, numbers bare,
  booleans `TRUE`/`FALSE`, missing → `NULL`; a non-scalar value fails the node).
  Add an `:ident` modifier — `{{input.field:ident}}` — to render the value as a
  quoted SQL **identifier** instead (double-quoted with `""` doubling), for the
  few statements that take a bare name and can't be parameterized, e.g.
  `VACUUM (ANALYZE) {{input.relname:ident}}`. The value must be a non-empty
  string; NULL/number/boolean fail the node so an identifier slot never silently
  vanishes or injects. · `http`: `{ method, url, headers, body }` · `js`: `{ code }`
- `js`: `{ code }` — the body receives `input`, returns the node output. Besides
  `input`/`console`, a curated **`crypto`** helper is in scope (no `require`):
  `crypto.hmac(algo, key, data, enc="hex")`, `crypto.hash(algo, data, enc="hex")`,
  `crypto.base64(s)`, `crypto.base64url(s)`, `crypto.hex(s)`, `crypto.randomUUID()`,
  `crypto.timingSafeEqual(a, b)`. Typical use: sign an outbound request, e.g.
  `return { ...input, sig: crypto.hmac('sha256', 'secret', JSON.stringify(input.body)) }`,
  then reference `input.sig` in a downstream `http` node's headers.
- `webhook`: `{ token }` — a trigger fired by an inbound HTTP request to the public
  hook route (see below). Passes the request as the run's initial input.
- `switch`: `{ cases: [{ expr, label }] }` · `loop`: `{ itemsExpr }`
- `schedule`: `{ frequency: "manual"|"hourly"|"daily", hourOfDay?: 0-23 }` — UTC.
  **Breaking change:** this replaces the old freeform `{ cron }` field, which is now inert.
- `export` ("Export SQL"): no config — dumps the workflow's own connection to a SQL
  file. Output: `{ filePath, sizeBytes, dialect }`. sqlite/postgresql only.
- `storage` ("Store to Storage"): `{ destinationIds: string[], retentionDays?: number, encrypt?: boolean }`
  — uploads the upstream node's `{ filePath }` output to each listed storage
  destination (see below). `encrypt` (default off) encrypts the file with a
  server-derived key (AES-256-GCM, scrypt off `ENCRYPTION_KEY`) before
  upload; `retentionDays` (default `0` = never) deletes objects older than that
  under the same connection's key prefix after a successful upload. Output:
  `{ uploaded: [{ destinationId, ok, key?, sizeBytes?, error?, encrypted?, prunedCount?, pruneError? }] }`.

Edges thread a single `input` (a node's output) to the next node; `sourceHandle`
selects a branch (`out` default; `case-N`/`default` for switch; `body`/`done` for loop).
Trigger nodes (`manual`/`schedule`/`webhook`) pass the run's initial input straight
through — `null` normally, the `input` posted to `/run` (e.g. a dashboard table row
from a row-action button), or the `{ body, query, headers, method }` of the inbound
request for a webhook run.

A workflow can be scheduled: set `workflows.schedule_enabled = 1` (via `PUT
.../workflows/:wid { "scheduleEnabled": true }`) with a graph containing exactly
one `schedule` node whose `frequency` is `hourly`/`daily` — the server then
computes `next_run_at` and a minutely cron tick (`WORKFLOW_SCHEDULER_ENABLED`)
fires it automatically, same execution path as a manual run. Every execution
(manual or scheduled) is persisted to `workflow_runs` (see below).

A workflow can be marked `protected` (`protected: 1`) — it then behaves like any
other workflow (listed, editable, runnable) except `DELETE` on it always 409s.
Nothing sets this automatically today; backups (below) are a separate system,
not a workflow.

> ⚠️ **Security:** the `/run` executor runs arbitrary SQL, makes server-side HTTP
> requests (internal URLs reachable — SSRF), and evaluates user JavaScript in a
> `node:vm` context, which is **not** a hard sandbox. This is acceptable because
> the routes sit behind auth + workspace-membership — the same trust level as the
> "run any SQL" query editor. Do not expose to untrusted users. Guards: per-JS 3s
> CPU timeout, ~5000-step budget, ~1000 loop iterations, ~20s overall cap for
> ordinary graphs — graphs containing `export`/`storage` get a 30-minute cap instead,
> since a full database dump + upload can legitimately take longer.

### GET `/api/connections/:id/workflows`
List workflows for a connection (newest first; no graph body). `folderId` is the
containing folder (null = root; see the polymorphic Folders API with `type=workflow`).

- **200:** `[{ "id", "name", "ts", "protected", "scheduleEnabled", "folderId" }]`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/workflows`

### POST `/api/connections/:id/workflows`
Create a workflow. `graph` is optional — omit it (or send a non-object) for an
empty graph; the frontend's JSON-import flow ("Import from JSON…" in the
Workflows panel) posts a sanitized graph here to create the workflow in one call.
`folderId` (optional) creates the workflow inside a folder.

- **Body:** `{ "name": "Nightly sync", "graph"?: { "nodes": [...], "edges": [...] }, "folderId"?: null }`
- **200:** `{ "id", "name", "graph", "folderId", "ts", "protected": false, "scheduleEnabled": false }`
- **400:** `{ "error": "A workflow name is required" }`
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/workflows`

### GET `/api/connections/:id/workflows/:wid`
Fetch one workflow with its full graph.

- **200:** `{ "id", "name", "graph": { "nodes": [...], "edges": [...] }, "protected", "scheduleEnabled" }`
- **404:** `{ "error": "Not found" }`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/workflows/wf-1`

### PUT `/api/connections/:id/workflows/:wid`
Update a workflow. Any subset of `name`, `graph`, `scheduleEnabled`, `folderId`.
Posting `graph` or `scheduleEnabled` recomputes `next_run_at` from the graph's
`schedule` node (cleared to `null` if the result wouldn't actually be scheduled).
`folderId: null` moves the workflow back to the root.

- **Body examples:**
  - Rename: `{ "name": "Renamed" }`
  - Save graph: `{ "graph": { "nodes": [...], "edges": [...] } }`
  - Activate schedule: `{ "scheduleEnabled": true }`
  - Move to folder: `{ "folderId": "fld-1" }`
- **200:** `{ "ok": true }`
- **400:** `{ "error": "Nothing to update" }` (or name validation)
- **404:** `{ "error": "Not found" }`
- **Example:** `PUT http://localhost:3000/api/connections/demo-sqlite/workflows/wf-1`

### DELETE `/api/connections/:id/workflows/:wid`
Delete a workflow.

- **200:** `{ "ok": true }`
- **404:** `{ "error": "Not found" }`
- **409:** `{ "error": "This workflow is protected and cannot be deleted." }`
- **Example:** `DELETE http://localhost:3000/api/connections/demo-sqlite/workflows/wf-1`

### POST `/api/connections/:id/workflows/:wid/run`
Execute a workflow. Runs the posted `graph` (so unsaved edits can be tested), or
the stored graph when `graph` is omitted. Always records the outcome in `workflow_runs`
(`trigger_kind` from `trigger`).

- **Body:** `{ "graph"?: { "nodes": [...], "edges": [...] }, "input"?: <any JSON>, "trigger"?: "manual" | "dashboard" }`
  - `input` (optional) seeds the trigger node — it flows to downstream nodes as their
    initial input (JS nodes read it as `input`, query nodes can inline scalars via
    `{{input.field}}`). Dashboard table-widget row actions post the clicked row here
    as a column→value object.
  - `trigger` (optional) tags the run in `workflow_runs.trigger_kind` for auditing:
    `"dashboard"` for dashboard row-action runs; anything else records `"manual"`.
- **200:** `{ "ok": true, "log": [{ "nodeId", "nodeType", "status", "ms", "output", "logs"?, "error"? }], "output": <terminal output> }`
  - On a failed node: `{ "ok": false, "log": [...], "error": "<message>" }` (the failing node's `log` entry has `status: "error"`)
- **404:** `{ "error": "Connection not found" }` or `{ "error": "Not found" }`
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/workflows/wf-1/run`

### GET `/api/connections/:id/workflows/:wid/runs`
The workflow's activity trail — recent runs (newest first), across every trigger
(`manual` / `dashboard` / `schedule` / `webhook`). The per-node `log` is omitted here;
fetch a single run for it.

- **Query:** `limit` (1–200, default 50), `offset` (default 0).
- **200:** `[{ "id", "triggerKind", "status": "success"|"failed", "error": string|null, "startedAt", "finishedAt", "ms": number|null }]`
- **404:** `{ "error": "Not found" }` (unknown workflow)
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/workflows/wf-1/runs?limit=20`

### GET `/api/connections/:id/workflows/:wid/runs/:runId`
One recorded run with its full per-node `log`.

- **200:** `{ "id", "triggerKind", "status", "ok", "log": [{ "nodeId", "nodeType", "status", "ms", "output", "logs"?, "error"? }], "error": string|null, "startedAt", "finishedAt", "ms" }`
- **404:** `{ "error": "Not found" }`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/workflows/wf-1/runs/run-abc`

### POST `/api/hooks/wf/:wid/:token`  ·  GET (same path)
**Public** (unauthenticated) webhook trigger — the one workflow route not behind
auth. Fires a workflow whose graph contains a `webhook` trigger node, guarding on
the node's opaque `token` (constant-time compared). The workflow runs with the
inbound request as its initial input: `{ body, query, headers, method }`. Records
the run in `workflow_runs` with `trigger_kind: "webhook"`.

- **Body:** any JSON (exposed to the graph as `input.body`); query params as `input.query`.
- **200:** `{ "ok": true, "output": <terminal output>, "error": null }`
- **500:** `{ "ok": false, "output": ..., "error": "<message>" }` (a node failed)
- **401:** `{ "error": "Invalid webhook token" }`
- **404:** `{ "error": "Not found" }` (unknown workflow) · `{ "error": "This workflow has no webhook trigger" }` · `{ "error": "Connection not found" }`
- **405:** `{ "error": "Use GET or POST" }`
- **Example:** `POST http://localhost:3000/api/hooks/wf/wf-1/9f3c…e21a`

> ⚠️ **Security:** the token is the *only* gate — anyone holding the URL can run the
> workflow (which itself can run SQL / make server-side HTTP calls / eval JS, per the
> warning above). Treat the URL as a secret; regenerate the token to revoke it.

---

## Dashboards (per connection)

Analytics dashboards (New Relic-style) rendered by the frontend. A dashboard is
a name + one JSON `config` blob: `{ "variables": [...], "widgets": [...] }` —
dynamic variables (query-backed or static lists) and chart/table/metric/text
widgets whose SQL may reference variables as `{{name}}`. The server stores the
config opaquely (its shape is owned by `src/features/dashboard/types.ts`) and
runs no SQL itself — widget queries execute through the existing
`POST /api/connections/:id/query`, so dashboards work with every database type
the query endpoint supports (SQLite, PostgreSQL, future dialects).

Dashboards can be organized into folders (see **Dashboard folders** below); each
dashboard carries an optional `folderId` (`null` = root).

### GET `/api/connections/:id/dashboards`
List dashboards for a connection (newest first; no config body).

- **200:** `[{ "id", "name", "folderId", "ts" }]`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/dashboards`

### POST `/api/connections/:id/dashboards`
Create a dashboard. `config` is optional (e.g. importing a JSON export);
defaults to `{ "variables": [], "widgets": [] }`. `folderId` is optional
(`null` = root; must reference an existing folder).

- **Body:** `{ "name": "Notifications", "config"?: { "variables": [...], "widgets": [...] }, "folderId"?: "fd-1" }`
- **200:** `{ "id", "name", "config", "folderId", "ts" }`
- **400:** `{ "error": "A dashboard name is required" }` / `{ "error": "Folder not found" }`
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/dashboards`

### GET `/api/connections/:id/dashboards/:did`
Fetch one dashboard with its full config.

- **200:** `{ "id", "name", "ts", "config": { "variables": [...], "widgets": [...] } }`
- **404:** `{ "error": "Not found" }`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/dashboards/db-1`

### PUT `/api/connections/:id/dashboards/:did`
Update a dashboard. Any subset of `name`, `config` (`config` replaces the whole
blob — the frontend always saves the full object), `folderId` (`null` moves the
dashboard back to the root).

- **Body examples:**
  - Rename: `{ "name": "Renamed" }`
  - Save layout/widgets/variables: `{ "config": { "variables": [...], "widgets": [...] } }`
  - Move to a folder: `{ "folderId": "fd-1" }`
- **200:** `{ "ok": true }`
- **400:** `{ "error": "Nothing to update" }` / `{ "error": "Folder not found" }` (or name/config validation)
- **404:** `{ "error": "Not found" }`
- **Example:** `PUT http://localhost:3000/api/connections/demo-sqlite/dashboards/db-1`

### DELETE `/api/connections/:id/dashboards/:did`
Delete a dashboard.

- **200:** `{ "ok": true }`
- **404:** `{ "error": "Not found" }`
- **Example:** `DELETE http://localhost:3000/api/connections/demo-sqlite/dashboards/db-1`

---

## Dashboard folders (per connection)

Named folders that organize a connection's dashboards into a tree, mirroring the
saved-query folders. A folder has a `parentId` (`null` = root); nesting is capped
at **3 levels deep** (enforced server-side on create and move). Deleting a folder
reparents its subfolders and dashboards up one level rather than deleting them.

### GET `/api/connections/:id/dashboard-folders`
List all dashboard folders for a connection (oldest first).

- **200:** `[{ "id", "name", "parentId", "ts" }]`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/dashboard-folders`

### POST `/api/connections/:id/dashboard-folders`
Create a folder. `parentId` is optional (`null` = root).

- **Body:** `{ "name": "Ops", "parentId"?: "fd-1" }`
- **200:** `{ "id", "name", "parentId", "ts" }`
- **400:** `{ "error": "A folder name is required" }` / `{ "error": "Parent folder not found" }` / `{ "error": "Folders can only nest 3 levels deep" }`
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/dashboard-folders`

### PUT `/api/connections/:id/dashboard-folders/:fid`
Rename (`name`) and/or reparent (`parentId`, `null` = root) a folder. Moves are
rejected if they create a cycle or push the subtree past the 3-level cap.

- **Body examples:** `{ "name": "Renamed" }` / `{ "parentId": "fd-2" }`
- **200:** `{ "ok": true }`
- **400:** `{ "error": "Can't move a folder into its own subfolder" }` / `{ "error": "Folders can only nest 3 levels deep" }` (or name/parent validation)
- **404:** `{ "error": "Not found" }`
- **Example:** `PUT http://localhost:3000/api/connections/demo-sqlite/dashboard-folders/fd-1`

### DELETE `/api/connections/:id/dashboard-folders/:fid`
Delete a folder; its subfolders and dashboards move up to the folder's own parent.

- **200:** `{ "ok": true }`
- **Example:** `DELETE http://localhost:3000/api/connections/demo-sqlite/dashboard-folders/fd-1`

---

## Storage destinations (workspace-scoped)

S3-compatible object storage (AWS S3, MinIO, R2, Backblaze B2, …) that backup
schedules upload dumps to (and that user-built workflows can also target via a
`storage` node). Same split as connections: plain columns for dialect-agnostic
fields, `accessKeyId`/`secretAccessKey`/`sessionToken` encrypted into
`credentials` (AES-256-GCM, key namespaced separately from connection credentials).

### Reserved "local" destination (server disk)

A backup schedule can also store dumps on the server's own disk instead of (or
alongside) S3 — the default when no S3 destination is configured. This is the
reserved destination id **`"local"`**: it is *not* a `storage_destinations` row
and is never returned by `GET /api/storages`, but it is accepted wherever a
`destinationId` is (backup schedule `destinationIds`, and the `destinationId`
path segment of the run download/delete/restore endpoints). Files are written
under `data/backups/<sanitized connection name>/<YYYY-MM-DD>/<dump>` (mirroring
the S3 key layout), and encryption/retention/download/delete/restore all behave
identically to an S3 destination. If a schedule's `destinationIds` is empty, the
backup falls back to `["local"]` at run time.

### GET `/api/storages?workspace=<id>`
List storage destinations in a workspace.

- **200:** `[{ "id", "workspaceId", "name", "endpoint", "region", "bucket", "pathPrefix", "forcePathStyle", "accessKeyId", "secretAccessKey", "sessionToken"? }]`
- **403:** `{ "error": "Forbidden" }` (not a member of the workspace)
- **Example:** `GET http://localhost:3000/api/storages?workspace=ws-1`

### POST `/api/storages`
Create a storage destination.

- **Body:** `{ "workspaceId", "name", "endpoint"?, "region"?, "bucket", "pathPrefix"?, "forcePathStyle"?, "accessKeyId", "secretAccessKey", "sessionToken"? }`
- **200:** the created destination (decrypted shape, as above)
- **400:** `{ "error": "A name and bucket are required" }`
- **Example:** `POST http://localhost:3000/api/storages`

### PUT `/api/storages/:sid`
Update a storage destination (full replace of the editable fields).

- **Body:** same shape as POST (partial patch merged onto the existing row)
- **200:** the updated destination
- **Example:** `PUT http://localhost:3000/api/storages/storage-1`

### DELETE `/api/storages/:sid`
Delete a storage destination.

- **200:** `{ "ok": true }`
- **409:** `{ "error": "This storage destination is used by a workflow and cannot be deleted." }` (any workflow's `storage` node still lists it)
- **Example:** `DELETE http://localhost:3000/api/storages/storage-1`

### POST `/api/storages/:sid/test`
Check the bucket is reachable with the stored credentials (`HeadBucketCommand`).

- **200:** `{ "ok": true, "message": "Connected! Bucket \"...\" is reachable." }` or `{ "ok": false, "message": "<error>" }`
- **Example:** `POST http://localhost:3000/api/storages/storage-1/test`

---

## Backup (per connection)

A standalone system — its own tables (`backup_schedules`, `backup_runs`) and
scheduler tick, **not** a workflow. It reuses the same export/upload/encrypt/
retention primitives a `storage` workflow node uses, but orchestrates them
directly (`runBackupOnce` → `execExportSql` → `execStoreToStorage`). One
schedule per connection. All schedule config (create + edit) is driven from
the frontend's Edit Connection → Backup tab; the connection's own Backup tab
is a read-only viewer (status, calendar, version list).

**Connection configuration in a backup.** With `includeConfig` on, each run
uploads a second artifact next to the database dump: the connection's export
document (the same JSON `GET /api/connections/:id/export` returns — settings,
folders, saved queries, workflows, dashboards, the schedule itself), named
`<uuid>.connection.json` in the same date folder, honoring the schedule's
`encrypt`. It is **always written without secrets** — the file may sit in a
bucket for years; rebuilding from it means re-entering the password via
`POST /api/connections/import`.

The config artifact is recorded **on** each destination's upload entry
(`configKey` / `configSizeBytes` / `configEncrypted`), not as an entry of its
own, so every lookup by `destinationId` (download, delete, restore) still
resolves the dump — the thing a restore needs. A failed config upload records
`configError` on the entry and does **not** fail the run: the dump already
succeeded, and failing would re-dump the whole database on every retry.
Retention pruning is unchanged — the dump's prune pass already sweeps the
whole folder by date, so both artifacts age out together.

### GET `/api/connections/:id/backup/schedule`
Current backup schedule for this connection (`null` if none exists yet).

- **200:** `{ "schedule": { "connectionId", "enabled", "frequency": "hourly"|"daily", "hourOfDay", "destinationIds", "retryLimit", "retryDelaySec", "retentionDays", "encrypt", "includeConfig" } | null }`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/backup/schedule`

### POST `/api/connections/:id/backup/schedule`
Create the connection's backup schedule. 409s if one already exists.

- **Body:** `{ "frequency": "hourly"|"daily", "hourOfDay"?: 0-23, "destinationIds": string[], "retryLimit"?: 0-5, "retryDelaySec"?: number, "retentionDays"?: number, "encrypt"?: boolean, "includeConfig"?: boolean, "enabled"?: boolean }`
  - `includeConfig` (default `false`) also uploads the connection's export JSON with each run — see the note above.
  - `destinationIds` may include real `storage_destinations.id`s and/or the reserved `"local"` (server disk). An **empty array is allowed** and falls back to `["local"]` at run time — see the "local" destination note under Storage destinations above.
- **200:** `{ "schedule": {...} }` (same shape as GET)
- **400:** invalid frequency/destinations, or connection type isn't sqlite/postgresql
- **409:** `{ "error": "This connection already has a backup schedule." }`
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/backup/schedule`

### PUT `/api/connections/:id/backup/schedule`
Update any subset of the schedule's fields — same body shape as POST, all
fields optional (unset ones keep their stored value). This is also how
Active/Paused toggles, via a lightweight `{ "enabled": false }` body.

- **200:** `{ "schedule": {...} }`
- **400:** invalid frequency/destinations
- **404:** `{ "error": "No backup schedule exists for this connection." }`
- **Example:** `PUT http://localhost:3000/api/connections/demo-sqlite/backup/schedule`

### POST `/api/connections/:id/backup/run`
Run the schedule immediately ("Run now") — a single attempt, no retry.

- **200:** `{ "ok": true|false, "error"?, "uploads": [...] }`
- **404:** connection or schedule not found
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/backup/run`

Scheduled runs (the minutely cron tick, `WORKFLOW_SCHEDULER_ENABLED`) retry on
failure up to `retryLimit` times with `retryDelaySec` between attempts, each
attempt its own `backup_runs` row (`trigger: "retry"`). If the schedule still
ends up failed after retries, the workspace's backup-failure notification
fires (see Workspaces → Notifications above).

### GET `/api/connections/:id/backup/calendar?days=365`
Per-day run counts (feeds the GitHub-style calendar — one color for "backed up
that day"; failures get their own reserved color).

- **200:** `{ "days": [{ "day": "2026-07-05", "runs": 2, "success": 2, "failed": 0 }, ...] }`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/backup/calendar?days=90`

### GET `/api/connections/:id/backup/runs?limit=20&offset=0&date=`
Paginated backup runs, including per-destination upload results (size,
encrypted, pruned count) the version list needs. Optional `date=YYYY-MM-DD`
filters to one UTC day (what clicking a calendar cell does in the UI).

- **200:** `{ "total": number, "runs": [{ "id", "trigger": "manual"|"schedule"|"retry", "status", "error"?, "startedAt", "finishedAt", "uploads": [{ "destinationId", "ok", "key"?, "sizeBytes"?, "error"?, "encrypted"?, "prunedCount"?, "pruneError"?, "deleted"?, "configKey"?, "configSizeBytes"?, "configEncrypted"?, "configError"? }] }] }`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/backup/runs?limit=20&offset=20`

### DELETE `/api/connections/:id/backup/runs/:runId/uploads/:destinationId`
Permanently deletes that uploaded artifact from storage — together with the
connection-config JSON (`configKey`) the same run shipped, so no orphan is left
behind. The `backup_runs` row and other uploads in it are untouched — this
upload is marked `deleted: true` (history stays visible; Restore/Download
disappear for it). Irreversible.

- **200:** `{ "ok": true }`
- **404:** run or deletable upload not found
- **500:** `{ "error": "<message>" }` (storage delete failure)
- **Example:** `DELETE http://localhost:3000/api/connections/demo-sqlite/backup/runs/run-1/uploads/storage-1`

### GET `/api/connections/:id/backup/runs/:runId/uploads/:destinationId/download`
Downloads that uploaded artifact (decrypted server-side first if `encrypted`)
as a file attachment (`Content-Disposition`).

- **Query:** `artifact` (optional — `config` downloads the connection JSON the
  run shipped beside the dump, named `<connection>-<date>.connection.json`;
  omitted/`dump` downloads the database dump)
- **200:** binary file stream
- **404:** run or downloadable upload not found (`No downloadable configuration found for this destination` when the run shipped no config)
- **500:** `{ "error": "<message>" }`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/backup/runs/run-1/uploads/storage-1/download?artifact=config`

### POST `/api/connections/:id/backup/restore`
Download a past backup artifact and overwrite a connection's live data in
place (sqlite: atomic file replace; postgresql: `pg_restore --clean --if-exists`).
Defaults to overwriting the source connection (`:id`); pass
`targetConnectionId` to restore into any **other** connection instead, as long
as it's in the same workspace and the same database type. If the matched
upload was `encrypted`, it's decrypted automatically first.

- **Body:** `{ "runId", "destinationId", "confirmName": "<must equal the TARGET connection's name>", "targetConnectionId"?: string }`
- **200:** `{ "ok": true }`
- **400:** confirmation mismatch, target in a different workspace/type, or no successful upload found for that destination
- **404:** connection/run/destination not found
- **500:** `{ "ok": false, "error": "<message>" }` (download/dialect-restore failure)
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/backup/restore`

### GET `/api/connections/:id/restore/storage-objects?destinationId=`
Lists a storage destination's stored files (newest first, capped at 500) so
the restore-from-storage picker can browse what's actually in the bucket (or
under `data/backups/` for `destinationId=local`). The destination must be the
built-in local disk or belong to the connection's workspace. S3 listings are
scoped to the destination's `pathPrefix`.

- **200:** `{ "objects": [{ "key": "myconn/2026-07-18/abc.dump.enc", "sizeBytes": 12345, "lastModified": 1752800000000|null }] }`
- **404:** connection or storage destination not found
- **500:** `{ "error": "<message>" }` (S3 listing failure)
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/restore/storage-objects?destinationId=storage-1`

### POST `/api/connections/:id/restore/from-storage`
Restores connection `:id` from any object in a storage destination — not just
tracked backup runs (use `POST .../backup/restore` for those). Keys ending in
`.enc` are decrypted server-side with this server's `ENCRYPTION_KEY` first.
SQLite targets are validated against the SQLite file header before the live
file is overwritten. Gated by typing the connection's name.

- **Body:** `{ "destinationId", "key", "confirmName": "<must equal the connection's name>" }`
- **200:** `{ "ok": true }`
- **400:** confirmation mismatch, missing key, unsupported connection type, or invalid local key
- **404:** connection or storage destination not found
- **500:** `{ "ok": false, "error": "<message>" }` (fetch/decrypt/restore failure)
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/restore/from-storage`

### POST `/api/connections/:id/restore/upload?filename=&confirmName=`
Restores connection `:id` from a backup file uploaded by the client. The file
is the **raw request body** (`Content-Type: application/octet-stream` — not
multipart), streamed to a temp file; `filename` and `confirmName` ride the
query string (URL-encoded). Max 2 GB. A `filename` ending in `.enc` is
decrypted server-side first; SQLite targets are header-validated as above.

- **Body:** raw file bytes
- **200:** `{ "ok": true }`
- **400:** confirmation mismatch, unsupported connection type, or empty upload
- **413:** upload exceeds the 2 GB limit
- **500:** `{ "ok": false, "error": "<message>" }` (decrypt/restore failure)
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/restore/upload?filename=backup.sqlite&confirmName=Demo%20SQLite`

---

## Schema migrations (per connection)

Audit trail of DDL commits. The frontend executes staged DDL via the existing
`/query` endpoint (below) as before; once a batch commits successfully, it
calls `POST .../schema/migrations` once to record what ran (and its best-effort
rollback SQL) and bump the connection's `schemaVersion`. One version per
successful commit batch, not per statement.

Each migration carries a `status` (`active` | `rollbacked`). `POST
.../schema/rollback` restores the schema to a target version by running the
down SQL of every still-active version newer than it and marking those
`rollbacked`, then resets `schemaVersion` back to the target (it does **not**
bump forward). Version numbers are therefore not globally unique — a rolled-back
`v2` and a later fresh `v2` can coexist; `status` distinguishes them.

### POST `/api/connections/:id/schema/migrations`
Record a successfully-executed DDL batch and bump `schema_version`.

- **Body:** `{ "statements": [{ "sql": "CREATE TABLE \"orders\" (...)", "rollbackSql": "DROP TABLE \"orders\";", "reversible": true, "label": "Create table orders" }, ...] }`
- **200:** `{ "version": 2, "migration": { "id", "connectionId", "version", "forwardSql": [...], "rollbackSql": [...], "reversible": true, "status": "active", "executorId", "executorName", "ts" } }`
- **400:** `{ "error": "At least one statement is required" }`
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/schema/migrations`

### GET `/api/connections/:id/schema/migrations`
List a connection's migration history, newest first (ordered by timestamp).

- **200:** `[{ "id", "version", "forwardSql": [...], "rollbackSql": [...], "reversible", "status": "active" | "rollbacked", "executorId", "executorName", "ts" }]`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/schema/migrations`

### POST `/api/connections/:id/schema/rollback`
Roll the schema back to `toVersion`. Runs the down SQL for every still-active
version newer than `toVersion` (newest first), marks those `rollbacked`, and
resets the connection's `schemaVersion` to `toVersion`. Requires every affected
version to be reversible. The target version itself stays active.

- **Body:** `{ "toVersion": 1, "database": "…"?, "schema": "…"? }` (`database`/`schema` optional, PG only)
- **200:** `{ "version": 1, "rolledBack": [3, 2] }`
- **400:** `{ "error": "Nothing to roll back for that version" }` / `{ "error": "v3 is not reversible — can't roll back past it" }`
- **404:** `{ "error": "Connection not found" }`
- **500:** `{ "error": "Rollback failed: <db message>" }`
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/schema/rollback`

---

## Schema & data browsing

> All routes below accept optional `?database=` and `?schema=` query params
> (PostgreSQL). SQLite ignores them.

### GET `/api/connections/:id/ping`
Connectivity check — tries to reach the database (`SELECT 1`). Generic across
engines; the client uses it to detect a dropped connection.

- **200:** `{ "ok": true }` or `{ "ok": false, "error": "<msg>" }` (both HTTP 200)
- **404:** `{ "ok": false, "error": "Connection not found" }`
- **Query:** optional `database`, `schema` (PG)
- **Example:** `GET http://localhost:3000/api/connections/demo-pg/ping`

### GET `/api/connections/:id/handshake`
Pre-flight connectivity check the console runs **before** it opens a connection
(the "Connect" button on the connections list). Same probe as `/ping`, but a
failure explains itself with a likely root cause instead of a bare `ok: false`,
so the user isn't dropped into a console where every panel fails on its own.
Never returns a 5xx: a failed handshake is a normal 200 payload. Times out after
`HANDSHAKE_TIMEOUT_MS` (default 8000) so a black-holed host answers in seconds.

- **Query:** optional `database`, `schema` (PG) / `database` (Redis db index)
- **200 (reachable):** `{ "ok": true, "latencyMs": 26, "type": "redis", "target": "127.0.0.1:6379" }`
- **200 (failed):**
  ```jsonc
  {
    "ok": false,
    "latencyMs": 4,
    "type": "postgresql",
    "target": "db.internal:5432",       // host:port, file path, or a URI's host — never credentials
    "reason": "auth",                   // stable code to branch on (see below)
    "cause": "PostgreSQL rejected the username or password.",
    "hint": "Re-enter the credentials in the connection settings; a rotated password is the usual cause.",
    "code": "28P01",                    // driver/libuv error code, when there is one
    "detail": "password authentication failed for user \"app\""   // raw driver error
  }
  ```
  - `reason` is one of `dns` | `refused` | `timeout` | `network` | `tls` | `auth` |
    `permission` | `missing_database` | `missing_file` | `busy` | `unsupported` |
    `unknown`. `cause`/`hint` are prose meant to be rendered as-is, so a client
    that doesn't know a newer `reason` still shows something useful.
  - Transport failures (refused/DNS/timeout/TLS) are classified generically for
    every engine; engine-specific replies (Postgres SQLSTATEs, Redis `NOAUTH`/
    `WRONGPASS`, SQLite file errors) come from that driver's `explainError` —
    see `server/db/diagnose.js`.
  - `reason: "at_capacity"` means the connection is reachable but already at its
    session limit. It carries two extra fields: `sessions` (the live sessions, same
    shape as `GET /sessions`) and `limit` (`{ max, source, active }`) so the UI can
    show who's holding them. See "Connection sessions" below.
- **404:** `{ "error": "Connection not found" }`
- **Example:** `GET http://localhost:3000/api/connections/demo-pg/handshake`

### Connection sessions
A **session is one open connection to the database** — the Postgres pool for a
database, the ioredis client for a db index, the SQLite file handle — *not* a
browser tab. Everyone browsing the same target shares one session and shows up as
a participant on it, so five people on one database count as one session.

Sessions are registered by the db layer itself: any call that touches a database
opens or refreshes the session for the handle it's about to use, and the session
disappears (releasing the handle) after `SESSION_IDLE_TTL_MS` with no activity.
There is no "open session" endpoint — nothing to leak or get out of sync with the
real sockets. They live in the session store (in-process, or Redis when
`SESSION_REDIS_URL` is set), which is what makes the count correct across replicas.

**The limit** resolves most-specific-first: the workspace's
`settings.sessions.maxPerConnection` → `MAX_SESSIONS_PER_CONNECTION` → unlimited.
0 at both levels means unlimited (the shipped default). A connection carries no
override of its own — a cap protects the database server, so it's a workspace
decision, not one to re-answer per connection. Opening a
*new* session past the limit fails with `429` (`GET /handshake` reports it as
`reason: "at_capacity"` instead — see above). Backup/restore are deliberately
exempt: a scheduled dump must not fail because people are browsing.

> Under a race two replicas can each open a handle at the same instant and exceed
> the limit by one. The count is never *under*-reported, which is the side that
> matters for protecting a database.

#### GET `/api/connections/:id/sessions`
Who's connected right now, and against what cap.

- **200:**
  ```jsonc
  {
    "active": 2,
    "max": 5,                    // 0 = unlimited
    "source": "connection",      // "connection" | "workspace" | "instance" | "unlimited"
    "sessions": [
      {
        "id": "postgresql:appdb/public",  // engine + the target the handle is on
        "connectionId": "…",
        "connectionName": "Prod",
        "type": "postgresql",
        "target": "appdb/public",
        "instanceId": "b0f864f2",         // which app replica holds the handle
        "openedAt": 1785485843801,
        "lastSeenAt": 1785485901120,
        "participants": { "<userId>": { "name": "Ada", "lastSeenAt": 1785485901120 } }
      }
    ]
  }
  ```
- **404:** `{ "error": "Connection not found" }`
- **Example:** `GET http://localhost:3000/api/connections/demo-pg/sessions`

#### DELETE `/api/connections/:id/sessions/:sessionId`
Leave a session. The caller is only removed as a participant; the session ends
(and its database handle is released) once the last participant is gone.
`?force=1` closes it outright for everyone — **workspace admins only**.

- **Path:** `sessionId` is the session's `id`, URL-encoded (it contains `:` and `/`)
- **Query:** `force` (optional — `1`/`true`/`yes`, admin only)
- **200:** `{ "ok": true, …the same shape as GET /sessions… }`
- **403:** `{ "error": "Admin only" }` (force, non-admin)
- **404:** `{ "error": "Connection not found" }`
- **Example:** `DELETE http://localhost:3000/api/connections/demo-pg/sessions/redis%3A(default)`

### GET `/api/connections/:id/tables`
List table names.

- **200:** `string[]` → `["users", "orders"]`
- **404:** `{ "error": "Connection not found" }`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/tables`
- **PG example:** `GET .../tables?database=appdb&schema=public`

### GET `/api/connections/:id/objects`
Generic list of every browsable database object, so the data browser can group
them by kind. Dialect-agnostic contract — each engine maps its own catalog onto
`{ name, type }` (SQLite: tables/views; PostgreSQL: tables/views/functions;
Redis (roadmap): keys by type).

- **200:** `Object[]`
  ```jsonc
  [
    { "name": "users", "type": "table" },
    { "name": "active_users", "type": "view", "materialized": false },
    { "name": "calc_total", "type": "function", "detail": "integer, integer" }
  ]
  ```
  - `type` is one of `table` | `view` | `function` (extensible per dialect).
  - Optional extras: `schema`, `materialized` (views), `detail` (function args).
- **Query:** optional `database`, `schema` (PG)
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/objects`

### GET `/api/connections/:id/function/:name`
Definition(s) of a function/routine by name (a name may have several overloads).
Empty for engines without listable functions (e.g. SQLite).

- **200:**
  ```jsonc
  [ { "name": "calc_total", "args": "a integer, b integer",
      "definition": "CREATE OR REPLACE FUNCTION public.calc_total(...) ..." } ]
  ```
- **Query:** optional `database`, `schema` (PG)
- **Example:** `GET http://localhost:3000/api/connections/demo-pg/function/calc_total`

### GET `/api/connections/:id/table/:table`
Read rows from a table (capped by `limit`).

- **Query:** `limit` (default `200`), plus optional `database`, `schema`
- **200:** `{ "columns": ["id", "name"], "rows": [ {…} ] }`
  - On a DB error the body is `{ "columns": [], "rows": [], "error": "<msg>" }` (HTTP 200)
- **Row order:** ordered by primary key when the table has one. Postgres writes a
  new tuple version on `UPDATE`, so an unordered read returns an edited row at the
  end of the heap — it looks like the edit was lost.
- **`__tg_rowid` (tables with no primary key only):** each row object also carries
  its physical row id — SQLite `rowid`, Postgres `ctid` (as text, e.g. `"(0,4)"`).
  It is deliberately **absent from `columns`**, so it never renders or exports; it
  exists so an edit can target the one row it came from. Views, `WITHOUT ROWID`
  tables and any table with a PK omit it.
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/table/users?limit=50000`
- **Example (no PK):** `{ "columns": ["rule_id","value"], "rows": [{ "__tg_rowid": "(0,4)", "rule_id": 2, "value": "…" }] }`

### GET `/api/connections/:id/columns/:table`
Column metadata for a table (used for PK detection, inserts, editing).

- **200:** `Column[]` → `[{ "name", "type", "notnull", "pk", "default", "autoIncrement", "references": { "table", "column" } | null }]`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/columns/users`

### GET `/api/connections/:id/indexes/:table`
Indexes on a table (shown in the schema tab's index grid).

- **200:**
  ```jsonc
  [
    { "name": "assets_pkey", "algorithm": "BTREE", "unique": true,
      "columns": "id", "condition": "", "include": "", "comment": "" }
  ]
  ```
- **Query:** optional `database`, `schema` (PG)
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/indexes/users`

### GET `/api/connections/:id/schema`
Map of every table to its column names (editor autocomplete).

- **200:** `{ "users": ["id", "name"], "orders": ["id", "user_id"] }`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/schema`

### GET `/api/connections/:id/namespaces`
Databases + schemas available on the connection (breadcrumb selector).

- **200 (SQLite):** `{ "databases": ["demo.db"], "schemas": ["main"], "currentDatabase": "demo.db" }`
- **200 (PostgreSQL):** `{ "databases": ["appdb", "postgres"], "schemas": ["public"], "currentDatabase": "appdb" }`
- **Query:** optional `database` (PG, to list schemas of another DB)
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/namespaces`

### GET `/api/connections/:id/types`
Column data types the schema editor offers for this connection's dialect.

- **200:** (Postgres uses the database's own type vocabulary, matching `/columns`)
  ```jsonc
  { "types": ["INTEGER", "TEXT", "REAL", "BLOB", "NUMERIC"] }   // sqlite
  // postgresql: ["serial","bigserial","smallint","integer","bigint","numeric",
  //   "character varying","timestamp without time zone", ...]
  ```
- **404:** `{ "error": "Connection not found" }`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/types`

### GET `/api/connections/:id/diagram`
Tables with columns + foreign-key relationships (ER diagram).

- **200:**
  ```jsonc
  {
    "tables": [{ "name": "orders", "columns": [Column, ...] }],
    "foreignKeys": [
      // `constraint` (PG only) is the constraint name, used to drop/modify the FK.
      { "constraint": "orders_user_id_fkey", "table": "orders", "column": "user_id",
        "refTable": "users", "refColumn": "id", "onDelete": "CASCADE", "onUpdate": "NO ACTION" }
    ]
  }
  ```
- **Query:** optional `database`, `schema` (PG)
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/diagram`

---

## Mutations

### POST `/api/connections/:id/insert`
Insert a single row (parameterized — values are bound, not interpolated).

- **Body:** `{ "table": "users", "values": { "name": "A", "active": true }, "database": "appdb", "schema": "public" }`
  (`database`/`schema` optional, PG only; booleans are coerced to `1/0` for SQLite)
- **200 (SQLite):** `{ "ok": true, "changes": 1, "lastInsertRowid": 42 }`
- **200 (PostgreSQL):** `{ "ok": true, "changes": 1 }`
- **400:** `{ "error": "A table and at least one value are required" }` or a DB error
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/insert`

### POST `/api/connections/:id/query`
Execute arbitrary SQL. SELECTs return rows; other statements return a message.
For PostgreSQL, a non-`public` `schema` is set on the search path first.

On a **Redis** connection `sql` carries raw command text instead — one command per
line, `#` comments and blank lines ignored, arguments quoted the way `redis-cli`
quotes them (SQL's `''` escape inside single quotes is accepted too, so a workflow
query node's `{{input.x}}` substitution round-trips). Replies are normalized into
the same shape: collections become rows, scalars/status replies become a message.
Blocking and connection-mode commands (`SUBSCRIBE`, `MONITOR`, `BLPOP`, `WAIT`, …)
are rejected — they would hold the pooled connection open indefinitely.

- **Body:** `{ "sql": "SELECT * FROM users", "database": "appdb", "schema": "public" }`
- **Body (Redis):** `{ "sql": "HGETALL cfg:app", "database": "db2" }`
- **200 (SELECT):** `{ "type": "rows", "columns": [...], "rows": [...] }`
- **200 (other):** `{ "type": "message", "message": "Query OK · 3 row(s) affected.", "rowCount": 3 }` (`rowCount` absent on Redis replies)
- **200 (SQL error):** `{ "error": "<driver message>" }` (note: HTTP 200, error in body)
- **400:** `{ "error": "SQL query required" }`
- **404:** `{ "error": "Connection not found" }`
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/query`

**Redis reply normalization**

| Reply | Result |
| --- | --- |
| `nil` | `{ "type": "message", "message": "(nil)" }` |
| Integer | `{ "type": "message", "message": "(integer) 3" }` |
| Simple/bulk string | `{ "type": "message", "message": "OK" }` |
| Multi-line string (`INFO`, `CLIENT LIST`) | `{ "type": "rows", "columns": ["line"], "rows": [{ "line": "..." }] }` |
| Array (`LRANGE`, `SMEMBERS`, `KEYS`) | `{ "type": "rows", "columns": ["#", "value"], "rows": [...] }` (nested arrays render as JSON in `value`) |
| Map (`HGETALL`, `CONFIG GET`) | `{ "type": "rows", "columns": ["field", "value"], "rows": [...] }` |
| More than one command in the buffer | `{ "type": "rows", "columns": ["#", "command", "status", "reply"], "rows": [...] }` — `status` is `OK` or `ERROR` per command, so a failure mid-batch is visible without aborting the rest |

Example — `{ "sql": "SET a 1\nINCR a\nBADCMD x" }`:
```json
{
  "type": "rows",
  "columns": ["#", "command", "status", "reply"],
  "rows": [
    { "#": 1, "command": "SET a 1", "status": "OK", "reply": "OK" },
    { "#": 2, "command": "INCR a", "status": "OK", "reply": 2 },
    { "#": 3, "command": "BADCMD x", "status": "ERROR", "reply": "ERR unknown command 'badcmd'..." }
  ]
}
```

### POST `/api/connections/:id/analyze`
Analyze one statement's performance. Runs the dialect's EXPLAIN machinery
(SQLite `EXPLAIN QUERY PLAN`, PostgreSQL `EXPLAIN (FORMAT JSON)`) and normalizes
the result into a dialect-agnostic shape with index and query suggestions.
Read-only SELECTs are additionally executed for real timings (`mode: "actual"`);
DML statements are only estimated and **never executed**. Any `EXPLAIN` prefix
already present in the SQL is stripped first. Suggested indexes are deduped
against the table's existing indexes.

- **Body:** `{ "sql": "SELECT * FROM users WHERE email = 'a@b.c'", "database": "appdb", "schema": "public" }`
  (`database`/`schema` optional, PG only)
- **200:**
  ```json
  {
    "dialect": "sqlite",
    "summary": { "mode": "actual", "executed": true, "elapsedMs": 1.42, "rowsReturned": 3 },
    "plan": [
      { "depth": 0, "step": "SCAN", "detail": "SCAN users", "table": "users",
        "index": null, "rows": null, "warning": "Full table scan" }
    ],
    "rawPlan": { "columns": ["id", "parent", "notused", "detail"], "rows": [...] },
    "indexSuggestions": [
      { "table": "users", "columns": ["email"],
        "reason": "Full table scan on \"users\" while filtering — …",
        "ddl": "CREATE INDEX \"idx_users_email\" ON \"users\" (\"email\");" }
    ],
    "querySuggestions": [
      { "code": "leading-wildcard-like", "message": "LIKE with a leading wildcard ('%…') cannot use an index — …" }
    ]
  }
  ```
  `summary.mode` is `"actual"` (query executed, real timings) or `"estimated"`
  (plan only). PostgreSQL responses also carry `summary.estimatedCost`.
- **400:** `{ "error": "SQL query required" }`, `{ "error": "Only a single statement can be analyzed." }`,
  `{ "error": "Only SELECT and data-modification statements can be analyzed." }`,
  `{ "error": "Query analysis is not supported for <type> connections." }`, or a driver error message
- **404:** `{ "error": "Connection not found" }`
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/analyze`

---

## Redis keyspace (per connection)

Redis has no tables, so the generic `/tables` and `/objects` routes return `[]` for
it and the console's sidebar reads the keyspace through these routes instead.
Everything else — running commands, workflow query nodes, dashboard widgets — goes
through the shared `POST /api/connections/:id/query` route above.

All four routes accept the `database` query param (`db0`…`dbN` or a bare index) and
answer `400 { "error": "Not a Redis connection (type: postgresql)." }` on any other
engine, `404` when the connection doesn't exist.

### GET `/api/connections/:id/redis/keys`
One `SCAN` page of the keyspace, each key enriched with its type and TTL (pipelined
`TYPE` + `PTTL`). Uses `SCAN`, never `KEYS`, so a keyspace with millions of keys
stays responsive. `cursor` is Redis's own opaque cursor — hand back what you got to
fetch the next page; `done` is true once it wraps to `"0"`. Note that a page can
legitimately come back empty while `done` is false.

- **Query:** `pattern` (glob, default `*`), `cursor` (default `"0"`), `count`
  (SCAN hint, clamped to 10–5000, default 300), `type` (filter to one Redis type),
  `database`
- **200:**
  ```json
  {
    "keys": [
      { "key": "user:1:name", "type": "string", "ttlMs": 299985 },
      { "key": "queue:jobs", "type": "list", "ttlMs": null }
    ],
    "cursor": "0",
    "done": true
  }
  ```
  `ttlMs` is `null` when the key never expires.
- **Example:** `GET http://localhost:3000/api/connections/<id>/redis/keys?pattern=user:*&count=500&database=db2`

### GET `/api/connections/:id/redis/overview`
Keyspace summary for the sidebar header.

- **Query:** `database`
- **200:** `{ "database": "db0", "keyCount": 128, "version": "7.4.2" }`
- **Example:** `GET http://localhost:3000/api/connections/<id>/redis/overview`

### GET `/api/connections/:id/redis/key`
One key's value as a generic `{ columns, rows }` page, plus its metadata. Every
collection type is paged by `offset`/`limit` so a million-element list can still be
opened. Columns per type: string → `["value"]`, list → `["index","value"]`, set →
`["#","member"]`, zset → `["rank","member","score"]`, hash → `["field","value"]`,
stream → `["id","fields"]`.

- **Query:** `key` (**required**), `offset` (default `0`), `limit` (1–5000, default `200`), `database`
- **200:**
  ```json
  {
    "key": "cfg:app",
    "type": "hash",
    "encoding": "listpack",
    "ttlMs": null,
    "length": 2,
    "offset": 0,
    "limit": 200,
    "hasMore": false,
    "columns": ["field", "value"],
    "rows": [{ "field": "debug", "value": "true" }, { "field": "ver", "value": "2" }]
  }
  ```
  `length` is the byte size for a string and the entry count for every collection
  type (`hasMore` is always `false` for a string — it isn't paged).
- **400:** `{ "error": "A key is required." }` or `{ "error": "Key \"ghost\" does not exist." }`
- **Example:** `GET http://localhost:3000/api/connections/<id>/redis/key?key=cfg:app&offset=0&limit=200`

### DELETE `/api/connections/:id/redis/keys`
Delete one or more keys (`DEL`).

- **Query:** `database`
- **Body:** `{ "keys": ["user:1:name", "user:2:name"] }`
- **200:** `{ "deleted": 2 }` (the count Redis actually removed — missing keys don't count)
- **400:** `{ "error": "At least one key is required." }`
- **Example:** `DELETE http://localhost:3000/api/connections/<id>/redis/keys`

### PUT `/api/connections/:id/redis/ttl`
Set or clear a key's expiry. `ttlMs` of `null` or `0` runs `PERSIST`; anything
positive runs `PEXPIRE`.

- **Query:** `database`
- **Body:** `{ "key": "session:abc", "ttlMs": 60000 }`
- **200:** `{ "ok": true, "ttlMs": 60000 }` (or `"ttlMs": null` after a clear)
- **400:** `{ "error": "A key is required." }` or
  `{ "error": "Key \"session:abc\" does not exist or already has no expiry." }`
- **Example:** `PUT http://localhost:3000/api/connections/<id>/redis/ttl`

---

## System / Updates

In-app update checking and the guided update flow. Detection compares the running
image identity `(version, sha)` — baked at build time via the `APP_VERSION` / `GIT_SHA`
build args — against the latest published GitHub Release and its `release.json`
contract asset.

**Applying** uses an auto-detected `applyMethod`:
- `docker` — the Docker socket is mounted (and we're in a container). The server
  pulls the new image and recreates its own container via the Engine API, handing
  the final stop/rename/start swap to a short-lived detached `docker:cli` helper.
- `manual` — no socket; the server returns the `docker compose pull` command for the UI.

Reads (`/version`, `/update/check`) require any authenticated user. Mutating routes
(`/backup`, `/backup/:file/download`, `/preflight`, `/update/apply`) require the caller
to be an **admin of at least one workspace** — otherwise `403 { "error": "Admin access required" }`.

Related env: `UPDATE_IMAGE` (default `ghcr.io/aidapedia/tabletsgo`), `UPDATE_REPO`
(default `aidapedia/tabletsgo`), `DOCKER_SOCKET` (default `/var/run/docker.sock`),
`UPDATE_HELPER_IMAGE` (default `docker:cli`).

### GET `/api/system/version`
The running app's identity (used by the wizard's verify-poll after a restart).
`autoCheckUpdates` is the instance-wide default (from the `UPDATE_AUTO_CHECK` env)
for the per-user "auto-check for updates" toggle in Settings > Updates.

- **200:** `{ "name": "tabletsgo", "version": "0.15.2", "sha": "20f10b5", "autoCheckUpdates": false }`
- **Example:** `GET http://localhost:3000/api/system/version`

### GET `/api/system/update/check?refresh=1`
Resolve update state. Cached in-memory ~30 min; `refresh=1` bypasses the cache.
On network failure it degrades to `{ ..., unreachable: true, updateAvailable: false }`.

- **Query:** `refresh` — `1`/`true` to force a fresh fetch.
- **200:**
  ```json
  {
    "current": { "version": "0.15.2", "sha": "20f10b5" },
    "latest":  { "version": "0.16.0", "sha": "a1b2c3d" },
    "updateAvailable": true,
    "breaking": false,
    "migrations": true,
    "minUpgradeFrom": "0.14.0",
    "upgradeBlocked": false,
    "image": "ghcr.io/aidapedia/tabletsgo:0.16.0",
    "applyMethod": "webhook",
    "checkedAt": 1752800000000,
    "releases": [
      { "version": "0.16.0", "name": "v0.16.0", "notes": "# What's new\n- ...", "url": "https://github.com/aidapedia/tabletsgo/releases/tag/v0.16.0", "publishedAt": "2026-07-18T00:00:00Z" }
    ]
  }
  ```
- `updateAvailable` is purely version-tag driven: it is `true` only when the latest release version is newer than the running version. Same-version rebuilds (moving-tag re-pushes with a different commit `sha`) are ignored and never prompt an update.
- **Example:** `GET http://localhost:3000/api/system/update/check?refresh=1`

### POST `/api/system/backup`
Snapshot the metadata DB (`app.db`) into `data/backups/` (rollback insurance). Admin only.

- **200:** `{ "ok": true, "file": "app-0.15.2-1752800000000.db", "sizeBytes": 245760, "createdAt": 1752800000000 }`
- **Example:** `POST http://localhost:3000/api/system/backup`

### GET `/api/system/backup/:file/download`
Stream a previously-taken snapshot (basename-sanitized; no path traversal). Admin only.

- **200:** the `.db` file as an attachment.
- **404:** `{ "error": "Backup not found" }`
- **Example:** `GET http://localhost:3000/api/system/backup/app-0.15.2-1752800000000.db/download`

### GET `/api/system/preflight`
Run pre-update validation checks. Admin only.

- **200:**
  ```json
  { "checks": [
    { "id": "integrity", "label": "Metadata database integrity", "status": "pass", "detail": "No corruption detected" },
    { "id": "disk", "label": "Free disk for snapshot", "status": "pass", "detail": "12040 MB free" },
    { "id": "apply", "label": "Update apply method", "status": "warn", "detail": "No webhook — a manual pull will be required" }
  ] }
  ```
  `status` is `pass` | `warn` | `fail`. A `fail` (e.g. corrupt DB, or `upgradeBlocked`) should block Apply.
- **Example:** `GET http://localhost:3000/api/system/preflight`

### POST `/api/system/update/apply`
Trigger the update using the auto-detected `applyMethod` (docker → manual). Admin only.

- **Body (optional):** `{ "tag": "0.16.0" }` — defaults to the latest known version.
- **200 (docker):** `{ "ok": true, "method": "docker", "message": "Pulling the new image and recreating the container — this will restart shortly.", "newContainerId": "…" }`
- **200 (manual):** `{ "ok": false, "method": "manual", "command": "docker compose pull && docker compose up -d", "image": "ghcr.io/aidapedia/tabletsgo:0.16.0" }`
- **500 (docker self-update failed):** `{ "error": "Docker self-update failed: …" }`
- **Example:** `POST http://localhost:3000/api/system/update/apply`

---

## Health

### GET `/api/health`
Liveness probe. Also reports boot readiness and the running identity.

- **200:** `{ "status": "ok", "ready": true, "version": "0.15.2", "sha": "20f10b5" }` (`status` is `starting` until migrations finish).
- **Example:** `GET http://localhost:3000/api/health`

---

## Endpoint summary

| Method | Path                                      | Purpose                         |
| ------ | ----------------------------------------- | ------------------------------- |
| POST   | `/api/auth/login`                         | Validate credentials            |
| POST   | `/api/auth/forgot`                        | Request password-reset link     |
| GET    | `/api/auth/reset/:token`                  | Validate reset token            |
| POST   | `/api/auth/reset/:token`                  | Set new password + log in       |
| GET    | `/api/connections`                        | List connections                |
| POST   | `/api/test-connection`                    | Test connectivity (no save)     |
| POST   | `/api/connections`                        | Create connection               |
| PUT    | `/api/connections/:id`                    | Update connection               |
| DELETE | `/api/connections/:id`                    | Delete connection (+ cascade)   |
| GET    | `/api/connections/:id/access`             | Read connection access (groups/users) |
| PUT    | `/api/connections/:id/owner`              | Transfer connection ownership   |
| PUT    | `/api/connections/:id/access`             | Set connection access (admin)   |
| GET    | `/api/resource-tree`                      | The visible resource tree, flat |
| GET    | `/api/resource-tree/catalog`              | Node types + where each role may be granted |
| GET    | `/api/resource-tree/:id`                  | One node: ancestors, children, grants, your access |
| POST   | `/api/resource-tree/:id/groups`           | Create a group under this node  |
| PUT    | `/api/resource-tree/:id`                  | Rename a group                  |
| PUT    | `/api/resource-tree/:id/move`             | Re-file a node under another group |
| PUT    | `/api/resource-tree/:id/owner`            | Hand a node over (owner only)   |
| DELETE | `/api/resource-tree/:id`                  | Delete a group (must be empty)  |
| GET    | `/api/resource-tree/:id/grants`           | Grants made on this node        |
| POST   | `/api/resource-tree/:id/grants`           | Grant a role here               |
| DELETE | `/api/resource-tree/:id/grants/:grantId`  | Revoke a grant                  |
| GET    | `/api/resource-tree/:id/members`          | Who is inside this group        |
| POST   | `/api/resource-tree/:id/members`          | Add someone to the group        |
| DELETE | `/api/resource-tree/:id/members/:userId`  | Remove someone from the group   |
| GET    | `/api/roles`                              | The instance's role catalog     |
| GET    | `/api/admin/permissions`                  | The permission catalog (grouped)|
| POST   | `/api/admin/roles`                        | Create a role                   |
| PUT    | `/api/admin/roles/:slug`                  | Rename / re-permission a role   |
| DELETE | `/api/admin/roles/:slug`                  | Delete a custom, unused role    |
| GET    | `/api/admin/workspaces`                   | Every workspace + its owners    |
| POST   | `/api/admin/workspaces`                   | Create one, assign an owner     |
| PUT    | `/api/admin/workspaces/:id`               | Rename a workspace              |
| DELETE | `/api/admin/workspaces/:id`               | Delete a workspace + contents   |
| GET    | `/api/admin/workspaces/:id/members`       | Its membership list             |
| PUT    | `/api/admin/workspaces/:id/members/:uid`  | Set a member's role             |
| DELETE | `/api/admin/workspaces/:id/members/:uid`  | Remove a member                 |
| GET    | `/api/admin/users`                        | Every account on the instance   |
| POST   | `/api/admin/users`                        | Create an account               |
| PUT    | `/api/admin/users/:id`                    | Rename / reset password / role  |
| POST   | `/api/admin/users/:id/unblock`            | Lift a brute-force block        |
| DELETE | `/api/admin/users/:id`                    | Delete an account               |
| GET    | `/api/admin/smtp`                         | The mail server + the env layer |
| PUT    | `/api/admin/smtp`                         | Save the mail server config     |
| DELETE | `/api/admin/smtp`                         | Drop it (fall back to env)      |
| POST   | `/api/admin/smtp/test`                    | Send a test email               |
| GET    | `/api/connections/:id/saved`              | List saved queries              |
| POST   | `/api/connections/:id/saved`              | Create saved query              |
| PUT    | `/api/connections/:id/saved/:sid`         | Update saved query / move       |
| DELETE | `/api/connections/:id/saved/:sid`         | Delete saved query              |
| GET    | `/api/connections/:id/folders`            | List folders (`?type=`; tables embed `tables`) |
| POST   | `/api/connections/:id/folders`            | Create folder (opt. `parentId`, `color`) |
| PUT    | `/api/connections/:id/folders/:fid`       | Rename / recolor / move folder  |
| PUT    | `/api/connections/:id/tables/:table/folder` | Set/clear a table's folder    |
| DELETE | `/api/connections/:id/folders/:fid`       | Delete folder (contents move up)|
| GET    | `/api/connections/:id/history`            | List query history              |
| POST   | `/api/connections/:id/history`            | Record a query execution        |
| DELETE | `/api/connections/:id/history`            | Clear query history             |
| POST   | `/api/connections/:id/schema/migrations`  | Record a DDL commit, bump version |
| GET    | `/api/connections/:id/schema/migrations`  | List schema migration history   |
| POST   | `/api/connections/:id/schema/rollback`    | Roll schema back to a version   |
| GET    | `/api/connections/:id/ping`               | Connectivity check `{ ok }`     |
| GET    | `/api/connections/:id/handshake`          | Pre-flight check + root cause   |
| GET    | `/api/connections/:id/sessions`           | Open sessions + the limit       |
| DELETE | `/api/connections/:id/sessions/:sid`      | Leave (or owner-close) a session|
| GET    | `/api/connections/:id/tables`             | List tables                     |
| GET    | `/api/connections/:id/objects`            | List objects (tables/views/fns) |
| GET    | `/api/connections/:id/function/:name`     | Function definition(s)          |
| GET    | `/api/connections/:id/table/:table`       | Read table rows                 |
| GET    | `/api/connections/:id/columns/:table`     | Column metadata                 |
| GET    | `/api/connections/:id/indexes/:table`     | Table indexes                   |
| GET    | `/api/connections/:id/schema`             | Table → columns map             |
| GET    | `/api/connections/:id/namespaces`         | Databases + schemas             |
| GET    | `/api/connections/:id/types`              | Column data types (per dialect) |
| GET    | `/api/connections/:id/diagram`            | Tables + foreign keys           |
| POST   | `/api/connections/:id/insert`             | Insert a row                    |
| POST   | `/api/connections/:id/query`              | Execute SQL / a Redis command   |
| POST   | `/api/connections/:id/analyze`            | Analyze query performance       |
| GET    | `/api/connections/:id/redis/keys`         | SCAN one page of the keyspace   |
| GET    | `/api/connections/:id/redis/overview`     | Redis db / key count / version  |
| GET    | `/api/connections/:id/redis/key`          | Read one key's value (paged)    |
| DELETE | `/api/connections/:id/redis/keys`         | Delete keys                     |
| PUT    | `/api/connections/:id/redis/ttl`          | Set / clear a key's expiry      |
| GET    | `/api/connections/:id/dashboards`         | List dashboards                 |
| POST   | `/api/connections/:id/dashboards`         | Create dashboard (opt. config)  |
| GET    | `/api/connections/:id/dashboards/:did`    | Fetch dashboard + config        |
| PUT    | `/api/connections/:id/dashboards/:did`    | Rename / save dashboard config  |
| DELETE | `/api/connections/:id/dashboards/:did`    | Delete dashboard                |
| GET    | `/api/storages`                           | List storage destinations       |
| POST   | `/api/storages`                           | Create storage destination      |
| PUT    | `/api/storages/:sid`                      | Update storage destination      |
| DELETE | `/api/storages/:sid`                      | Delete storage destination      |
| POST   | `/api/storages/:sid/test`                 | Test bucket reachability        |
| GET    | `/api/connections/:id/backup/schedule`    | Current backup schedule         |
| POST   | `/api/connections/:id/backup/schedule`    | Create the backup schedule      |
| PUT    | `/api/connections/:id/backup/schedule`    | Update the backup schedule      |
| POST   | `/api/connections/:id/backup/run`         | Run the backup schedule now     |
| GET    | `/api/connections/:id/backup/calendar`    | Per-day backup run counts       |
| GET    | `/api/connections/:id/backup/runs`        | Paginated backup runs           |
| DELETE | `/api/connections/:id/backup/runs/:runId/uploads/:destinationId` | Delete a backup version |
| GET    | `/api/connections/:id/backup/runs/:runId/uploads/:destinationId/download` | Download a backup version |
| POST   | `/api/connections/:id/backup/restore`     | Restore a backup version        |
| GET    | `/api/connections/:id/restore/storage-objects` | Browse a storage destination's files |
| POST   | `/api/connections/:id/restore/from-storage` | Restore from a picked storage object |
| POST   | `/api/connections/:id/restore/upload`     | Restore from an uploaded file   |
| GET    | `/api/system/version`                     | Running app identity (version/sha) |
| GET    | `/api/system/update/check`                | Check for a newer release       |
| POST   | `/api/system/backup`                      | Snapshot the metadata DB (admin) |
| GET    | `/api/system/backup/:file/download`       | Download a meta-DB snapshot (admin) |
| GET    | `/api/system/preflight`                   | Pre-update validation checks (admin) |
| POST   | `/api/system/update/apply`                | Trigger the update (admin)      |
| GET    | `/api/health`                             | Health check + readiness/identity |
