---
name: db-engine
description: The engine-agnostic database layer in server/db/ — the driver contract, the optional-vs-required capability split, the connection handshake/diagnosis, and how Redis (the first non-relational engine) adapts without forking the contract. Use this skill when adding or changing a database driver (sqlite/postgres/redis or a new engine like MariaDB/MySQL/MongoDB), when touching server/db/*, when a route needs to work across engines, when writing or debugging /api/connections/:id/query, /tables, /objects, /columns, /indexes, /diagram, /insert, /analyze, /handshake or /redis/*, when you are tempted to write `if (conn.type === ...)` in a route, or when diagnosing why connecting to a database failed.
---

# The DB layer

`server/db/index.js` defines one vocabulary; `sqlite.js` / `postgres.js` /
`redis.js` each adapt a single engine to it. **Adding an engine is one driver
file plus one entry in `DRIVERS`** — no caller changes.

**No route branches on `conn.type`.** The db layer answers for every engine. If
you find yourself writing that branch in `server.js`, the logic belongs in a
driver or in the generic dispatch.

## The driver contract

A driver is a plain object whose methods take `(conn, ctx, …)`, where `ctx` is
`{ database, schema }` and each engine reads only what it understands:

- SQLite ignores both.
- Postgres pools per database and defaults `schema` to `'public'`.
- Redis reads `database` as its numbered db.

The full method list is documented at the top of `server/db/index.js` — **keep
that comment accurate, it is the contract.**

## Optional vs required capabilities

A driver **omits** what its engine doesn't have, and the generic layer decides
what that means at the API edge:

- **optional** ops answer with the empty result (`listTables` → `[]`,
  `getDiagram` → `{tables:[],foreignKeys:[]}`), so Redis just shows nothing.
- **required** ops throw `UnsupportedError` (status 400) naming the type —
  `insertRow`, `analyze`, `runQuery`, `dump`, `restore`.

Use `db.requireCapability(conn, op)` to fail *before* unrelated work (that's how
`/analyze` tells a Redis user about Redis instead of about SQL syntax), and
`db.supports(conn, 'dump')` to gate a feature without naming an engine.

Never leave a route without an answer for an engine — a missing branch used to
mean `res.json(undefined)` and a hung request; the generic layer is what makes
that impossible now.

## The connection handshake

`GET /api/connections/:id/handshake` (→ `db.handshake`) is the pre-flight the
console runs **before** routing into a connection: `ping` says yes/no, the
handshake says *why not*.

It **never throws** — a failure is a normal 200
`{ ok:false, reason, cause, hint, code?, detail }`, timed out after
`HANDSHAKE_TIMEOUT_MS`.

The diagnosis follows the same edge rule as everything else:
`server/db/diagnose.js` classifies what's engine-agnostic (refused, DNS,
timeout, TLS, unreachable), and a driver adds only what its engine alone can
explain through the optional `explainError(error, conn)` — Postgres SQLSTATEs,
Redis error replies, SQLite file errors.

`reason` is a stable code the UI maps to a headline; `cause`/`hint` are prose it
renders as-is, so a new reason never breaks an older client. Frontend side:
`useConnectHandshake` + `ConnectHandshakeDialog` in `features/connections`.

A session-limit rejection surfaces here as `reason:'at_capacity'` with the
session list, so the connect dialog can name who's holding them.

## Redis — the shape every non-relational engine should follow

Redis is the first supported engine with no tables and no SQL. **The rule: adapt
at the edges, never fork the contract.** `server/db/redis.js` owns everything
Redis-specific and returns the *same* generic result shape the SQL engines do
(`{ type: 'rows', columns, rows }` | `{ type: 'message', message }` | `{ error }`)
— which is exactly why the `/query` route, workflow query nodes and dashboard
widgets work against Redis with no Redis-aware code in them.

- **Commands ride the SQL route.** `POST /api/connections/:id/query` takes command
  text in `sql` for a Redis connection; it reaches the driver through the same
  `db.runQuery(conn, ctx, sql)` the SQL engines use, so the route has no Redis
  branch at all. One command per line (`#` comments dropped); a multi-command
  buffer returns one summary row per command (`#`/`command`/`status`/`reply`) so a
  mid-batch failure is visible rather than aborting. Blocking/connection-mode
  commands (`SUBSCRIBE`, `MONITOR`, `BLPOP`, `WAIT`, …) are rejected — they'd hold
  the pooled client open forever.
- **Browsing gets its own routes**, not overloaded table ones: `GET/DELETE
  .../redis/keys`, `.../redis/key`, `.../redis/overview`, `PUT .../redis/ttl`. The
  relational routes answer for Redis too, via the optional/required split above:
  `/tables`, `/objects`, `/columns`, `/indexes` and `/diagram` return the empty
  result, while `/insert`, `/analyze` and the backup schedule `400` naming the
  type. The keyspace routes reach the driver's Redis-only ops
  (`scanKeys`/`readKey`/`overview`/`deleteKeys`/`setTtl`) through
  `db.drivers.redis`, guarded by `requireRedis`.
- **Always `SCAN`, never `KEYS`.** `KEYS` blocks the server on a large keyspace.
  The key list is cursor-paged; the frontend keeps pulling pages until it has a
  screenful because a `SCAN` page can legitimately come back empty before the
  cursor wraps.
- **`database` is the numbered db.** Clients are pooled per `(connection, resolved
  db)`. A `redis://…/N` URI's path is only the *default* — `redisConfig` strips it
  and passes `db` explicitly, because ioredis otherwise lets the URI override the
  option and pins the connection to one database, silently breaking the console's
  db picker. The pool key uses the resolved db so a client is never handed back for
  a database it isn't on.
- **Frontend:** `src/features/redis` swaps two console pieces on
  `conn.type === 'redis'` — `RedisKeyTree` for the tables sidebar and
  `RedisConsole` for the query tab (plus a `redisKey` tab kind). The schema
  designer, table folders, create-table and query analysis are hidden rather than
  stubbed, since Redis has no equivalent. `RedisConsole`/`RedisEditor` stay **out
  of the feature barrel** (they pull in CodeMirror) — same code-split rule as
  `WorkflowEditor` and `DashboardView`.
- **Not supported, on purpose:** schema migrations (no DDL, so `schemaVersion`
  never moves and the status bar shows the namespace instead), `EXPLAIN`-style
  analysis, row-grid editing, and the S3 backup schedule (the driver has no
  `dump`, so `db.supports(conn, 'dump')` is false).

## Connection records

The `connections` table stores dialect-agnostic fields (`type`, `name`,
`workspace_id`, `environment`, `folder`, `tags`, `schema_version`) as plain
columns and everything else
(host/port/username/password/filepath/database/uri/sslmode/tls/auth/keychain) as
one AES-256-GCM-encrypted JSON blob in `credentials`.
`server/connections.js`'s `rowToConnection`/`connectionToRow` reassemble/split the
flat connection shape the frontend has always used — the API contract for
`/api/connections*` didn't change, only storage.

Redis deliberately **reuses the same field names** as PostgreSQL
(host/port/username/password/database/uri) so nothing downstream needs a Redis
branch; only `tls` (`'' | 'require' | 'insecure'`) is its own, standing in for
`sslmode`. Follow this when adding an engine: reuse an existing field name unless
the concept genuinely has no counterpart.

## Adding a new engine — checklist

1. Write `server/db/<engine>.js` adapting the contract; omit what the engine lacks.
2. Add one entry to `DRIVERS` in `server/db/index.js`.
3. Add `explainError(error, conn)` for what only that engine can explain.
4. Add the type to the frontend `DB_CATALOG`/`TYPE_LABEL` in
   `features/connections/components/DbTypePickerModal`.
5. Reuse existing credential field names where the concept maps.
6. Document new endpoints in `BACKEND_DOCUMENTATION.MD` and update `README.md`'s
   database-compatibility section.
7. Verify no caller needed changing — if one did, the abstraction leaked.
