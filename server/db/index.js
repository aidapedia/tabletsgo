/**
 * The generic database layer.
 *
 * Everything above this module (routes, workflows, dashboards, backups) speaks
 * one engine-agnostic vocabulary; everything below it — server/db/sqlite.js,
 * postgres.js, redis.js — adapts a single engine to that vocabulary. The rule
 * from CLAUDE.md holds here: **adapt at the edges, never fork the contract**.
 * Adding an engine means adding one driver file and one entry in DRIVERS; no
 * caller should ever need a new `conn.type` branch.
 *
 * ## The driver contract
 *
 * A driver is a plain object. Every method receives the stored connection first
 * and a `ctx` ({ database, schema }) second, so a driver reads only the parts of
 * the request that mean something to it (SQLite ignores both; Postgres pools per
 * database and defaults `schema` to 'public'; Redis reads `database` as its
 * numbered db). Methods may be sync or async — callers always `await`.
 *
 *   type, label, dataTypes        identity + the column types the schema editor offers
 *   testConnection(config)        → { ok, message }; `config` is unsaved form input
 *   explainError(error, conn)     → { reason, cause, hint } for an engine-specific
 *                                   failure the generic classifier can't read (optional;
 *                                   see ./diagnose.js)
 *   prewarm(conn)                 open eagerly at boot (optional)
 *   release(conn)                 drop cached handles/pools for this connection
 *   closeAll()                    shutdown
 *   ping(conn, ctx)               → { ok: true } or throws
 *   namespaces(conn, ctx)         → { databases, schemas, currentDatabase }
 *   listTables(conn, ctx)         → string[]
 *   listObjects(conn, ctx)        → [{ name, type, … }]
 *   listFunctions(conn, ctx, n)   → [{ name, args, definition }]
 *   getTableData(conn, ctx, { table, limit })  → { columns, rows, error? }
 *   getColumns(conn, ctx, table)  → [{ name, type, notnull, pk, default, autoIncrement, references }]
 *   getIndexes(conn, ctx, table)  → [{ name, algorithm, unique, columns, condition, … }]
 *   getSchemaMap(conn, ctx)       → { table: [column, …] } for editor autocomplete
 *   getDiagram(conn, ctx)         → { tables, foreignKeys }
 *   insertRow(conn, ctx, { table, values })    → { ok, changes, … }
 *   runQuery(conn, ctx, sql)      → { type:'rows', columns, rows } | { type:'message', message } | { error }
 *                                 (a failed statement is `{ error }`, not a throw —
 *                                  see runQueryOrThrow below for the other contract)
 *   analyze(conn, ctx, { sql, cls })           → { dialect, summary, plan, rawPlan, …Suggestions }
 *   dump(conn, destPath)          write a restorable dump of the whole database
 *   restore(conn, dumpPath)       overwrite the live database with one
 *
 * Every op that takes `ctx` is dispatched through `gatedRequired`/`gatedOptional`,
 * which register a *session* for the handle the call is about to use (see
 * server/sessions) and refuse to open a new one past the connection's resolved
 * session limit (a workspace/instance setting — see server/sessions/limits.js).
 * Drivers know nothing about it — sessions are counted where the decision to
 * open a handle is made, not inside each engine.
 *
 * A driver simply omits what its engine doesn't have. Two kinds of omission are
 * distinguished here, because the two behave differently at the API edge:
 *
 *  - **optional** ops answer with the empty result (Redis has no tables, so
 *    `listTables` is `[]` rather than an error — the sidebar just shows nothing).
 *  - **required** ops throw `UnsupportedError` (status 400) naming the type, so
 *    a route never silently hangs or returns `undefined`.
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { BACKUP_TMP_DIR, HANDSHAKE_TIMEOUT_MS } from '../config.js'
import { SessionLimitError, setReleaseHandler, touchConnectionSession } from '../sessions/index.js'
import { diagnose, targetOf } from './diagnose.js'
import { sqliteDriver } from './sqlite.js'
import { postgresDriver } from './postgres.js'
import { redisDriver } from './redis.js'

export const drivers = {
  sqlite: sqliteDriver,
  postgresql: postgresDriver,
  redis: redisDriver,
}

// Thrown when an engine can't answer at all. `status` lets routes reply with a
// 400 that names the type instead of a generic 500.
export class UnsupportedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UnsupportedError'
    this.status = 400
  }
}

export function driverFor(conn) {
  const driver = conn && drivers[conn.type]
  if (!driver) throw new UnsupportedError(`Unsupported connection type: ${conn?.type}`)
  return driver
}

// True when this engine implements `op` — e.g. `supports(conn, 'dump')` gates
// the backup schedule without naming a single engine.
export const supports = (conn, op) => typeof drivers[conn?.type]?.[op] === 'function'

// How each required op explains itself when an engine doesn't have it. These
// strings are user-facing (they surface in the console), so they name the type.
const UNSUPPORTED = {
  testConnection: (conn) => `Unsupported connection type: ${conn.type}`,
  namespaces: (conn) => `Namespaces are not supported for ${conn.type} connections.`,
  insertRow: (conn) => `Row insert is not supported for ${conn.type} connections.`,
  runQuery: (conn) => `Unsupported connection type: ${conn.type}`,
  analyze: (conn) => `Query analysis is not supported for ${conn.type} connections.`,
  dump: (conn) => `Export not supported for connection type: ${conn.type}`,
  restore: (conn) => `Restore not supported for connection type: ${conn.type}`,
}

// Assert an engine can do something *before* doing unrelated work — lets a
// route answer "Redis can't be analyzed" instead of "that isn't valid SQL".
export function requireCapability(conn, op) {
  const driver = driverFor(conn)
  if (typeof driver[op] !== 'function') {
    throw new UnsupportedError(UNSUPPORTED[op]?.(conn) || `${op} is not supported for ${conn.type} connections.`)
  }
  return driver
}

// Dispatch to an op every engine must answer.
const required = (op) => (conn, ...args) => requireCapability(conn, op)[op](conn, ...args)

// Dispatch to an op some engines simply don't have; `empty` (a value or a
// function of the connection) is the answer for those.
const optional = (op, empty) => (conn, ...args) => {
  const driver = driverFor(conn)
  if (typeof driver[op] !== 'function') return typeof empty === 'function' ? empty(conn) : empty
  return driver[op](conn, ...args)
}

/**
 * Register the session for the handle this call needs, before the driver opens
 * it. Every op whose second argument is `ctx` goes through one of the `gated`
 * dispatchers below, so a session exists for exactly as long as the app is
 * really using the connection — there's no separate "open session" call that
 * could drift out of sync with the sockets.
 *
 * Throws SessionLimitError (429) when a *new* handle would exceed the
 * connection's resolved session limit. Backup/restore stay ungated on purpose: a
 * scheduled dump must not fail because people are browsing.
 */
export const enterSession = (conn, ctx = {}) => touchConnectionSession(conn, ctx, ctx.actor)

const gatedRequired = (op) => async (conn, ctx, ...args) => {
  const driver = requireCapability(conn, op)
  await enterSession(conn, ctx)
  return driver[op](conn, ctx, ...args)
}

const gatedOptional = (op, empty) => async (conn, ctx, ...args) => {
  const driver = driverFor(conn)
  if (typeof driver[op] !== 'function') return typeof empty === 'function' ? empty(conn) : empty
  await enterSession(conn, ctx)
  return driver[op](conn, ctx, ...args)
}

// Releasing a handle is the db layer's job; deciding *when* is the session
// sweeper's. Wire the two without making sessions depend on this module.
setReleaseHandler((conn) => releaseConnection(conn))

// ---- Lifecycle ----
export const testConnection = (config) => requireCapability(config, 'testConnection').testConnection(config)
export const prewarmConnection = optional('prewarm', undefined)
export const releaseConnection = optional('release', undefined)
export const closeAllConnections = () => {
  for (const driver of Object.values(drivers)) driver.closeAll?.()
}

// Column types the schema editor offers. Schemaless engines report none.
export const dataTypesFor = (conn) => drivers[conn?.type]?.dataTypes || []

// ---- Introspection ----
export const ping = gatedOptional('ping', { ok: true })

// Reject with `code: 'ETIMEDOUT'` when `promise` outlives `ms`, so a handshake
// against a black-holed host answers in seconds instead of riding the driver's
// own (much longer) TCP timeout.
function withTimeout(promise, ms) {
  let timer
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error(`Timed out after ${ms}ms.`), { code: 'ETIMEDOUT' })),
      ms
    )
    timer.unref?.()
  })
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer))
}

/**
 * Pre-flight connectivity check with a *reason* when it fails.
 *
 * `ping` answers yes/no; this answers "why not" — the console runs it before
 * opening a connection so a user lands on a root cause instead of a workspace
 * that fails one panel at a time. It never throws: a failure is a normal
 * `{ ok: false, reason, cause, hint }` payload (see ./diagnose.js).
 */
export async function handshake(conn, ctx) {
  const started = Date.now()
  const base = { type: conn?.type, target: targetOf(conn) }
  try {
    driverFor(conn) // unknown engine → UnsupportedError, handled below
    await withTimeout(Promise.resolve(ping(conn, ctx)), HANDSHAKE_TIMEOUT_MS)
    return { ok: true, latencyMs: Date.now() - started, ...base }
  } catch (error) {
    let failure
    if (error instanceof UnsupportedError) {
      failure = { reason: 'unsupported', cause: error.message, hint: 'Update TabletsGo or pick a supported database type.', detail: error.message }
    } else if (error instanceof SessionLimitError) {
      // Reachable, just full — say so in the same shape as any other failure,
      // and hand the UI the session list so it can show who's holding them.
      failure = {
        reason: 'at_capacity',
        cause: error.message,
        hint:
          error.info?.source === 'workspace'
            ? 'Wait for a session to end, or raise the workspace default for max sessions per connection.'
            : 'Wait for a session to end, or raise this instance\'s MAX_SESSIONS_PER_CONNECTION.',
        detail: error.message,
        sessions: error.info?.sessions || [],
        limit: { max: error.info?.max, source: error.info?.source, active: error.info?.active },
      }
    } else {
      failure = diagnose(drivers[conn?.type], conn, error)
    }
    return { ok: false, latencyMs: Date.now() - started, ...base, ...failure }
  }
}
export const namespaces = gatedRequired('namespaces')
export const listTables = gatedOptional('listTables', [])
export const listObjects = gatedOptional('listObjects', [])
export const listFunctions = gatedOptional('listFunctions', [])
export const getColumns = gatedOptional('getColumns', [])
export const getIndexes = gatedOptional('getIndexes', [])
export const getSchemaMap = gatedOptional('getSchemaMap', {})
export const getDiagram = gatedOptional('getDiagram', { tables: [], foreignKeys: [] })
// Tableless engines (Redis) browse through their own routes; the grid shows the
// message rather than an empty table it can't explain.
export const getTableData = gatedOptional('getTableData', (conn) => ({
  columns: [],
  rows: [],
  error: `Table browsing is not supported for ${conn.type} connections.`,
}))

// ---- Data ----
export const insertRow = gatedRequired('insertRow')
export const analyze = gatedRequired('analyze')

// Execute one statement (or, on a command-driven engine, one command buffer)
// against the connection's target database. A *statement-level* failure comes
// back as `{ error }` rather than throwing — that's what lets the /query route
// hand a syntax error to the console like any other result.
export const runQuery = gatedRequired('runQuery')

// The throwing variant, for callers running a sequence that must stop at the
// first failure instead of carrying on as if it had succeeded: schema rollback
// and the workflow query node. Anything that reports a result to the user
// directly should use `runQuery` and let the error ride in the payload.
export async function runQueryOrThrow(conn, ctx, sql) {
  const result = await runQuery(conn, ctx, sql)
  if (result?.error) throw new Error(result.error)
  return result
}

// ---- Backup / restore ----
// Dumps the connection's whole database to a staging file.
// Output: { filePath, sizeBytes, dialect } — the shape the storage node expects.
export async function exportDatabaseToFile(conn) {
  const driver = requireCapability(conn, 'dump')
  const filePath = path.join(BACKUP_TMP_DIR, `${randomUUID()}.dump`)
  await driver.dump(conn, filePath)
  return { filePath, sizeBytes: fs.statSync(filePath).size, dialect: conn.type }
}

// Overwrites a connection's live data with the dump file at `dumpPath`. Shared
// by every restore path (backup run, storage browse, file upload) — the caller
// has already validated the target, its type, and the confirmation.
export const restoreDatabaseFromFile = required('restore')
