# Backend API Documentation

Reference for migrating the Tabletsgo backend (`server.js`). Lists every HTTP
endpoint with its request, response, and an example URL.

---

## Conventions

- **Base URL:** `http://localhost:3000` (port from `PORT` env, default `3000`).
- **API prefix:** all endpoints live under `/api`.
- **Content type:** requests and responses are JSON. JSON body limit is `10mb`.
- **CORS:** enabled for all origins (`cors()` with defaults).
- **Auth:** there is **no token/session**. `POST /api/auth/login` only validates
  credentials and returns the user object; subsequent routes are unauthenticated.
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

### Static frontend

If a `dist/` build exists, it is served as static files with an SPA fallback:
any non-`/api/...` GET returns `dist/index.html`. Otherwise unknown routes return
`404 { "error": "Not found" }`.

---

## Data models

### Connection
Stored as JSON in the metadata DB. SQLite and PostgreSQL variants:

```jsonc
// SQLite
{
  "id": "demo-sqlite",
  "name": "Demo Database",
  "type": "sqlite",
  "environment": "local",
  "filepath": "./demo.db",
  "folder": "Demo"
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
  "sslmode": "verify-full"   // optional: disable | require | verify-full
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
  data TEXT NOT NULL,           -- JSON-serialized connection
  created_at INTEGER
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
```

**Seeds on first run:** user `admin` / `admin123` (role `admin`), and a
`demo-sqlite` connection pointing at `./demo.db` (auto-seeded with sample data
when empty).

---

# Endpoints

## Auth

### POST `/api/auth/login`
Validate credentials. No token issued — returns the user on success.

- **Body:** `{ "username": "admin", "password": "admin123" }`
- **200:** `{ "id": "uuid", "username": "admin", "name": "Admin", "role": "admin" }`
- **401:** `{ "error": "Invalid username or password" }`
- **Example:** `POST http://localhost:3000/api/auth/login`

---

## Connections

### GET `/api/connections`
List all saved connections (ordered by creation time).

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
Create a connection. Server assigns the `id` (UUID).

- **Body:** connection object **without** `id` (see Data models)
- **200:** the created connection (with `id`)
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

## Schema & data browsing

> All routes below accept optional `?database=` and `?schema=` query params
> (PostgreSQL). SQLite ignores them.

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
| GET    | `/api/connections`                        | List connections                |
| POST   | `/api/test-connection`                    | Test connectivity (no save)     |
| POST   | `/api/connections`                        | Create connection               |
| PUT    | `/api/connections/:id`                    | Update connection               |
| DELETE | `/api/connections/:id`                    | Delete connection (+ cascade)   |
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
| GET    | `/api/health`                             | Health check                    |
