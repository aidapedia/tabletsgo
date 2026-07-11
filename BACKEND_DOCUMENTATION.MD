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
  membership; unauthenticated → `401`, non-member → `403`. Roles are per workspace
  (`admin` | `member`).
- **Error shape:** errors return `{ "error": "<message>" }` with an HTTP status of
  `400` (bad input), `401` (bad login), `404` (not found), or `500` (server error).
  The query/insert/test routes return DB errors in the body too (see each route).
- **Path params:** `:id` = connection id, `:table` = table name, `:sid` = saved
  query id, `:fid` = folder id.
- **Query params** (where supported):
  - `database` — target database on the same server (PostgreSQL multi-db browsing).
  - `schema` — target schema (PostgreSQL, default `public`).
  - `limit` — row cap for table data (default `200`).

### Environment variables

| Variable  | Default            | Purpose                                  |
| --------- | ------------------ | ---------------------------------------- |
| `PORT`    | `3000`             | HTTP listen port.                        |
| `META_DB` | `./data/app.db`    | SQLite file storing app metadata (below).|
| `CONNECTION_ENCRYPTION_KEY` | *(required)* | AES-256-GCM key encrypting connection credentials at rest — server refuses to start without it. Also derives (with a distinct salt) the key used for storage-destination credentials. |
| `WORKFLOW_SCHEDULER_ENABLED` | `true` | Set to `false` to disable the minutely cron tick that fires workflows with an active hourly/daily schedule (including backups). Useful for local dev/CI. |

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
```

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
{ "id": "uuid", "name": "Reports", "ts": 1719600000000 }
```

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
  "default": null,
  "references": { "table": "users", "column": "id" } // null when not a foreign key (only on /columns)
}
```

### Query result (from `/query`)
```jsonc
// SELECT
{ "type": "rows", "columns": ["id", "name"], "rows": [{ "id": 1, "name": "A" }] }
// non-SELECT
{ "type": "message", "message": "Query OK · 3 row(s) affected." }
// failure (HTTP 200, error in body)
{ "error": "no such table: foo" }
```

---

## Metadata database (`data/app.db`, SQLite)

The server keeps its own SQLite DB (separate from user connections) with these
tables. Recreate these when migrating.

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,  -- sha256(password) hex
  name TEXT,
  role TEXT
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
  ts INTEGER
);
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
  destination_ids TEXT,           -- JSON array of storage_destinations.id
  retry_limit INTEGER DEFAULT 0,        -- extra attempts after a scheduled failure (0-5)
  retry_delay_sec INTEGER DEFAULT 60,   -- delay between attempts
  retention_days INTEGER DEFAULT 0,     -- prune uploads older than this after each run (0 = never)
  encrypt INTEGER DEFAULT 0,      -- encrypt the dump (AES-256-GCM, server-derived key) before upload
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
  uploads TEXT,                   -- JSON: [{destinationId, ok, key?, sizeBytes?, encrypted?, error?, prunedCount?, deleted?}]
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  ts INTEGER NOT NULL
);
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER
);
CREATE TABLE team_members (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER,
  UNIQUE(team_id, user_id)
);
CREATE TABLE connection_access (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,   -- "team" | "user"
  principal_id TEXT NOT NULL,     -- teams.id or users.id
  created_at INTEGER,
  UNIQUE(connection_id, principal_type, principal_id)
);
```

**Seeds on first run:** user `admin` / `admin123` (role `admin`), and a
`demo-sqlite` connection pointing at `./demo.db` (auto-seeded with sample data
when empty).

---

# Endpoints

## Auth & setup

`user` shape: `{ id, email, name, role }`. `{ user, token }` is returned by login,
setup and accept-invite; store the token and send it as `Authorization: Bearer`.

### POST `/api/auth/login`
- **Body:** `{ "username": "you@example.com", "password": "…" }` (`username` is the email)
- **200:** `{ "user": { … }, "token": "uuid" }` · **401:** `{ "error": "Invalid email or password" }`

### POST `/api/auth/logout`
Invalidate the current session token. **200:** `{ "ok": true }`

### POST `/api/auth/forgot`
Request a password-reset link. **Always 200** `{ "ok": true }` — never reveals
whether the email exists. When SMTP is available (env, else any of the user's
workspaces' SMTP) the reset link is emailed; the link is **never** returned.
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

## Workspaces (auth required)

- `GET /api/workspaces` → `[{ id, name, role, createdAt, experiments, notifications }]`
  the caller belongs to. `experiments` is `{ [key]: boolean }` (see Beta experiments
  below) — included for every member, not just admins, since it gates what the
  whole workspace sees. `notifications` ships here too (not just the detail route)
  so a settings panel that only calls `refresh()`/`listWorkspaces()` after saving
  sees the persisted value instead of it reverting to empty.
- `POST /api/workspaces` `{ name }` → creates one; caller becomes `admin`.
- `GET /api/workspaces/:id` → `{ id, name, role, createdAt, experiments, notifications }`;
  admins also get `smtp` (password-masked) + `smtpEnvFallback` + `smtpEnvDefaults`
  (non-secret env values — `host`, `port`, `secure`, `user`, `from` — present
  only when `smtpEnvFallback` is true).
- `PUT /api/workspaces/:id` (admin) `{ name?, smtp?, experiments?, notifications? }` → `{ ok: true }`.
  `smtp` is `{ host, port, secure, user, from, pass? }`; omit `pass` to keep the
  stored one. `experiments` is a partial `{ [key]: boolean }`, merged onto the
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
  every listed member via the workspace's SMTP config (see `smtpConfig`). Manual
  "Run now" failures never trigger this.
- `POST /api/workspaces/:id/smtp/test` (admin) `{ to?, smtp? }` → `{ ok: true }`
  or `400 { error }`. Sends a one-off test email. `to` defaults to the caller's
  own email. `smtp` (same shape as `PUT`, minus `pass` falling back to the
  stored one) lets the UI test unsaved form values; omit it entirely to test
  the saved/env config as-is.
- `DELETE /api/workspaces/:id` (admin) → deletes it + its connections/queries.
  `400` if it's the caller's only workspace.

### Members
- `GET /api/workspaces/:id/members` → `[{ userId, email, name, role, status }]`.
- `POST /api/workspaces/:id/members` (admin) `{ email }` → `{ member, inviteLink, emailed }`.
  Existing accounts are added directly; otherwise a pending user + invite link is
  created (and emailed when SMTP is configured; `inviteLink` returned regardless).
- `DELETE /api/workspaces/:id/members/:userId` (admin) → `{ ok: true }`. Can't
  remove yourself or the last admin. Also drops the removed user from every team
  in this workspace.

### Teams
Workspace-scoped groups of members. A team can be assigned as an access principal
to a connection (see Connection access) and as a notification recipient. Managed
from the frontend's Workspace → Teams tab. Any member can read; only admins mutate.
- `GET /api/workspaces/:id/teams` → `[{ id, name, memberCount, createdAt }]`.
- `POST /api/workspaces/:id/teams` (admin) `{ name }` → `{ id, name, memberCount: 0, createdAt }`.
- `PUT /api/workspaces/:id/teams/:teamId` (admin) `{ name }` → `{ ok: true }`.
- `DELETE /api/workspaces/:id/teams/:teamId` (admin) → `{ ok: true }`. Cascades:
  removes the team's members and any `connection_access` rows assigning it.
- `GET /api/workspaces/:id/teams/:teamId/members` → `[{ userId, email, name }]`.
- `POST /api/workspaces/:id/teams/:teamId/members` (admin) `{ userId }` → `{ ok: true }`.
  `400` if the user isn't a member of the workspace.
- `DELETE /api/workspaces/:id/teams/:teamId/members/:userId` (admin) → `{ ok: true }`.
- **Example:** `POST http://localhost:3000/api/workspaces/ws_123/teams` body `{ "name": "Backend" }`.

---

## Connections

### GET `/api/connections`
List connections in a workspace the caller belongs to. Results are further filtered
by **connection access** (see below): a connection with no access rows is visible to
every workspace member; one with access rows is visible only to workspace admins, its
assigned individual members, and members of its assigned teams.
- **Query:** `workspace` (required — the workspace id). Missing → `[]`.

- **200:** `Connection[]` (array of connection objects)
- **Example:** `GET http://localhost:3000/api/connections`

### POST `/api/test-connection`
Test connectivity without saving. Body is a connection-shaped object.

- **Body (SQLite):** `{ "type": "sqlite", "filepath": "./demo.db" }`
- **Body (PostgreSQL):** `{ "type": "postgresql", "host": "...", "port": 5432, "username": "...", "password": "...", "database": "...", "sslmode": "disable" }`
- **200 (success):** `{ "ok": true, "message": "Connected! 5 table(s) found." }`
- **200 (failure):** `{ "ok": false, "message": "<driver error>" }` (note: failures still return HTTP 200)
- **Example:** `POST http://localhost:3000/api/test-connection`

### POST `/api/connections`
Create a connection. Server assigns the `id` (UUID). The `ownerId` defaults to the
authenticated caller unless one is supplied in the body. The response includes the
resolved `ownerName` / `ownerEmail`.

- **Body:** connection object **without** `id` (see Data models); `ownerId` optional
- **200:** the created connection (with `id`, `ownerId`, `ownerName`, `ownerEmail`)
- **Example:** `POST http://localhost:3000/api/connections`

### PUT `/api/connections/:id`
Update a connection. Merges body into the existing record; drops cached
pools/handles so the next query reconnects with new settings.

- **Body:** partial or full connection fields to change
- **200:** the updated connection
- **404:** `{ "error": "Connection not found" }`
- **Example:** `PUT http://localhost:3000/api/connections/demo-sqlite`

### DELETE `/api/connections/:id`
Delete a connection and cascade-delete its saved queries and folders. Also
closes any open pool/handle.

- **200:** `{ "ok": true }`
- **404:** `{ "error": "Connection not found" }`
- **Example:** `DELETE http://localhost:3000/api/connections/demo-sqlite`

### Connection access
Controls which teams / individual members may see and open a connection. An empty
set means the connection is open to every workspace member (backward compatible).
Any set restricts visibility to workspace admins + the listed users + members of the
listed teams. Enforced by the `GET /api/connections` list filter and the
`/api/connections/:id/*` access guard.

#### GET `/api/connections/:id/access`
Read the current assignment (any caller who already has access).
- **200:** `{ "teams": ["team_1"], "users": ["user_1"] }` (id arrays; empty = open)
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/access`

#### PUT `/api/connections/:id/access`
Replace the assignment (workspace **admin** only). Send the full desired set.
- **Body:** `{ "teams": ["team_1"], "users": ["user_1"] }` (either may be omitted → treated as `[]`)
- **200:** the stored `{ teams, users }`
- **403:** `{ "error": "Admin only" }`
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

### GET `/api/connections/:id/folders`
List folders (oldest first).

- **200:** `Folder[]` → `[{ "id", "name", "ts" }]`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/folders`

### POST `/api/connections/:id/folders`
Create a folder.

- **Body:** `{ "name": "Reports" }`
- **200:** `{ "id", "name", "ts" }`
- **400:** `{ "error": "A folder name is required" }`
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/folders`

### PUT `/api/connections/:id/folders/:fid`
Rename a folder.

- **Body:** `{ "name": "Renamed" }`
- **200:** `{ "ok": true, "name": "Renamed" }`
- **400:** `{ "error": "A folder name is required" }`
- **404:** `{ "error": "Not found" }`
- **Example:** `PUT http://localhost:3000/api/connections/demo-sqlite/folders/fld-1`

### DELETE `/api/connections/:id/folders/:fid`
Delete a folder. Its queries are detached back to the root (`folder_id = NULL`),
not deleted.

- **200:** `{ "ok": true }`
- **Example:** `DELETE http://localhost:3000/api/connections/demo-sqlite/folders/fld-1`

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
`manual` (trigger), `schedule` (trigger), `query`, `http`, `js`, `switch`, `loop`,
`export`, `storage`, and its config lives in `node.data`:
- `query`: `{ sql }` · `http`: `{ method, url, headers, body }` · `js`: `{ code }`
- `switch`: `{ cases: [{ expr, label }] }` · `loop`: `{ itemsExpr }`
- `schedule`: `{ frequency: "manual"|"hourly"|"daily", hourOfDay?: 0-23 }` — UTC.
  **Breaking change:** this replaces the old freeform `{ cron }` field, which is now inert.
- `export` ("Export SQL"): no config — dumps the workflow's own connection to a SQL
  file. Output: `{ filePath, sizeBytes, dialect }`. sqlite/postgresql only.
- `storage` ("Store to Storage"): `{ destinationIds: string[], retentionDays?: number, encrypt?: boolean }`
  — uploads the upstream node's `{ filePath }` output to each listed storage
  destination (see below). `encrypt` (default off) encrypts the file with a
  server-derived key (AES-256-GCM, scrypt off `CONNECTION_ENCRYPTION_KEY`) before
  upload; `retentionDays` (default `0` = never) deletes objects older than that
  under the same connection's key prefix after a successful upload. Output:
  `{ uploaded: [{ destinationId, ok, key?, sizeBytes?, error?, encrypted?, prunedCount?, pruneError? }] }`.

Edges thread a single `input` (a node's output) to the next node; `sourceHandle`
selects a branch (`out` default; `case-N`/`default` for switch; `body`/`done` for loop).

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
List workflows for a connection (newest first; no graph body).

- **200:** `[{ "id", "name", "ts", "protected", "scheduleEnabled" }]`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/workflows`

### POST `/api/connections/:id/workflows`
Create a workflow with an empty graph.

- **Body:** `{ "name": "Nightly sync" }`
- **200:** `{ "id", "name", "graph": { "nodes": [], "edges": [] }, "ts", "protected": false, "scheduleEnabled": false }`
- **400:** `{ "error": "A workflow name is required" }`
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/workflows`

### GET `/api/connections/:id/workflows/:wid`
Fetch one workflow with its full graph.

- **200:** `{ "id", "name", "graph": { "nodes": [...], "edges": [...] }, "protected", "scheduleEnabled" }`
- **404:** `{ "error": "Not found" }`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/workflows/wf-1`

### PUT `/api/connections/:id/workflows/:wid`
Update a workflow. Any subset of `name`, `graph`, `scheduleEnabled`. Posting
`graph` or `scheduleEnabled` recomputes `next_run_at` from the graph's `schedule`
node (cleared to `null` if the result wouldn't actually be scheduled).

- **Body examples:**
  - Rename: `{ "name": "Renamed" }`
  - Save graph: `{ "graph": { "nodes": [...], "edges": [...] } }`
  - Activate schedule: `{ "scheduleEnabled": true }`
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
(`trigger_kind: "manual"`).

- **Body:** `{ "graph"?: { "nodes": [...], "edges": [...] } }`
- **200:** `{ "ok": true, "log": [{ "nodeId", "nodeType", "status", "ms", "output", "logs"?, "error"? }], "output": <terminal output> }`
  - On a failed node: `{ "ok": false, "log": [...], "error": "<message>" }` (the failing node's `log` entry has `status: "error"`)
- **404:** `{ "error": "Connection not found" }` or `{ "error": "Not found" }`
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/workflows/wf-1/run`

---

## Storage destinations (workspace-scoped)

S3-compatible object storage (AWS S3, MinIO, R2, Backblaze B2, …) that backup
schedules upload dumps to (and that user-built workflows can also target via a
`storage` node). Same split as connections: plain columns for dialect-agnostic
fields, `accessKeyId`/`secretAccessKey`/`sessionToken` encrypted into
`credentials` (AES-256-GCM, key namespaced separately from connection credentials).

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

### GET `/api/connections/:id/backup/schedule`
Current backup schedule for this connection (`null` if none exists yet).

- **200:** `{ "schedule": { "connectionId", "enabled", "frequency": "hourly"|"daily", "hourOfDay", "destinationIds", "retryLimit", "retryDelaySec", "retentionDays", "encrypt" } | null }`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/backup/schedule`

### POST `/api/connections/:id/backup/schedule`
Create the connection's backup schedule. 409s if one already exists.

- **Body:** `{ "frequency": "hourly"|"daily", "hourOfDay"?: 0-23, "destinationIds": string[], "retryLimit"?: 0-5, "retryDelaySec"?: number, "retentionDays"?: number, "encrypt"?: boolean, "enabled"?: boolean }`
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

- **200:** `{ "total": number, "runs": [{ "id", "trigger": "manual"|"schedule"|"retry", "status", "error"?, "startedAt", "finishedAt", "uploads": [{ "destinationId", "ok", "key"?, "sizeBytes"?, "error"?, "encrypted"?, "prunedCount"?, "pruneError"?, "deleted"? }] }] }`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/backup/runs?limit=20&offset=20`

### DELETE `/api/connections/:id/backup/runs/:runId/uploads/:destinationId`
Permanently deletes that uploaded artifact from storage. The `backup_runs` row
and other uploads in it are untouched — this upload is marked `deleted: true`
(history stays visible; Restore/Download disappear for it). Irreversible.

- **200:** `{ "ok": true }`
- **404:** run or deletable upload not found
- **500:** `{ "error": "<message>" }` (storage delete failure)
- **Example:** `DELETE http://localhost:3000/api/connections/demo-sqlite/backup/runs/run-1/uploads/storage-1`

### GET `/api/connections/:id/backup/runs/:runId/uploads/:destinationId/download`
Downloads that uploaded artifact (decrypted server-side first if `encrypted`)
as a file attachment (`Content-Disposition`).

- **200:** binary file stream
- **404:** run or downloadable upload not found
- **500:** `{ "error": "<message>" }`
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/backup/runs/run-1/uploads/storage-1/download`

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
- **Example:** `GET http://localhost:3000/api/connections/demo-sqlite/table/users?limit=50000`

### GET `/api/connections/:id/columns/:table`
Column metadata for a table (used for PK detection, inserts, editing).

- **200:** `Column[]` → `[{ "name", "type", "notnull", "pk", "default", "references": { "table", "column" } | null }]`
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

- **Body:** `{ "sql": "SELECT * FROM users", "database": "appdb", "schema": "public" }`
- **200 (SELECT):** `{ "type": "rows", "columns": [...], "rows": [...] }`
- **200 (other):** `{ "type": "message", "message": "Query OK · 3 row(s) affected." }`
- **200 (SQL error):** `{ "error": "<driver message>" }` (note: HTTP 200, error in body)
- **400:** `{ "error": "SQL query required" }`
- **404:** `{ "error": "Connection not found" }`
- **Example:** `POST http://localhost:3000/api/connections/demo-sqlite/query`

---

## Health

### GET `/api/health`
Liveness probe.

- **200:** `{ "status": "ok" }`
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
| GET    | `/api/connections/:id/access`             | Read connection access (teams/users) |
| PUT    | `/api/connections/:id/access`             | Set connection access (admin)   |
| GET    | `/api/workspaces/:id/teams`               | List teams (+ member counts)    |
| POST   | `/api/workspaces/:id/teams`               | Create team (admin)             |
| PUT    | `/api/workspaces/:id/teams/:teamId`       | Rename team (admin)             |
| DELETE | `/api/workspaces/:id/teams/:teamId`       | Delete team (admin, cascade)    |
| GET    | `/api/workspaces/:id/teams/:teamId/members` | List team members             |
| POST   | `/api/workspaces/:id/teams/:teamId/members` | Add team member (admin)       |
| DELETE | `/api/workspaces/:id/teams/:teamId/members/:userId` | Remove team member (admin) |
| GET    | `/api/connections/:id/saved`              | List saved queries              |
| POST   | `/api/connections/:id/saved`              | Create saved query              |
| PUT    | `/api/connections/:id/saved/:sid`         | Update saved query / move       |
| DELETE | `/api/connections/:id/saved/:sid`         | Delete saved query              |
| GET    | `/api/connections/:id/folders`            | List folders                    |
| POST   | `/api/connections/:id/folders`            | Create folder                   |
| PUT    | `/api/connections/:id/folders/:fid`       | Rename folder                   |
| DELETE | `/api/connections/:id/folders/:fid`       | Delete folder (detach queries)  |
| GET    | `/api/connections/:id/history`            | List query history              |
| POST   | `/api/connections/:id/history`            | Record a query execution        |
| DELETE | `/api/connections/:id/history`            | Clear query history             |
| POST   | `/api/connections/:id/schema/migrations`  | Record a DDL commit, bump version |
| GET    | `/api/connections/:id/schema/migrations`  | List schema migration history   |
| POST   | `/api/connections/:id/schema/rollback`    | Roll schema back to a version   |
| GET    | `/api/connections/:id/ping`               | Connectivity check `{ ok }`     |
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
| POST   | `/api/connections/:id/query`              | Execute SQL                     |
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
| GET    | `/api/health`                             | Health check                    |
