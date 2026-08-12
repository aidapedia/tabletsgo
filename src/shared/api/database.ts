/**
 * Database layer that communicates with the backend server
 * for real SQLite and PostgreSQL connections
 */

import { request, safeRequest } from '@/shared/api/request'

// A connection may carry a selected namespace `ns: { database, schema }` so
// requests can browse other databases/schemas on the same connection.
function nsParams(conn) {
  const p = new URLSearchParams()
  if (conn?.ns?.database) p.set('database', conn.ns.database)
  if (conn?.ns?.schema) p.set('schema', conn.ns.schema)
  return p
}
// Append the namespace query params to a request path.
function withNs(conn, path) {
  const qs = nsParams(conn).toString()
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path
}
const nsBody = (conn) => ({ database: conn?.ns?.database, schema: conn?.ns?.schema })

export async function getDb(conn) {
  // Return the connection object - actual queries are made via API
  return conn
}

export async function listTables(conn) {
  return safeRequest(withNs(conn, `/connections/${conn.id}/tables`), [])
}

// Connectivity check → { ok: boolean, error?: string }.
export async function pingConnection(conn) {
  return safeRequest(withNs(conn, `/connections/${conn.id}/ping`), { ok: false, error: 'Unable to reach the server.' })
}

// One open driver handle for a connection (a pool for a database, a Redis
// client for a db index, a SQLite file handle) — what "max sessions" counts.
// Everyone browsing the same target shares one session as a participant.
export type ConnectionSession = {
  id: string
  connectionId: string
  connectionName?: string
  type?: string
  target: string
  instanceId?: string
  openedAt: number
  lastSeenAt: number
  participants: Record<string, { name: string; lastSeenAt: number }>
}

export type SessionStats = {
  active: number
  max: number // 0 = unlimited
  source: 'connection' | 'workspace' | 'instance' | 'unlimited'
  sessions: ConnectionSession[]
}

export async function listConnectionSessions(conn): Promise<SessionStats> {
  return safeRequest<SessionStats>(`/connections/${conn.id}/sessions`, {
    active: 0,
    max: 0,
    source: 'unlimited',
    sessions: [],
  })
}

// Leave a session (`force` closes it for everyone — workspace admins only).
export async function endConnectionSession(conn, sessionId: string, force = false) {
  const qs = force ? '?force=1' : ''
  return request(`/connections/${conn.id}/sessions/${encodeURIComponent(sessionId)}${qs}`, { method: 'DELETE' })
}

// A failed handshake explains itself: `reason` is a stable code to branch on,
// `cause`/`hint` are prose to render, `detail` is the raw driver error.
export type Handshake = {
  ok: boolean
  latencyMs?: number
  type?: string
  target?: string
  reason?: string
  cause?: string
  hint?: string
  detail?: string
  code?: string
  // reason === 'at_capacity' only: who is holding the sessions, and the cap.
  sessions?: ConnectionSession[]
  limit?: { max?: number; source?: string; active?: number }
}

// Pre-flight probe before opening a connection — same check as `pingConnection`,
// but a failure comes back with a root cause instead of a bare `ok: false`.
export async function handshakeConnection(conn): Promise<Handshake> {
  return safeRequest<Handshake>(withNs(conn, `/connections/${conn.id}/handshake`), {
    ok: false,
    reason: 'network',
    cause: 'The TabletsGo server could not be reached.',
    hint: 'Check that the server is running and that your session has not expired, then try again.',
  })
}

// Generic browsable objects: [{ name, type, ... }] (tables, views, functions, …).
export async function listObjects(conn) {
  return safeRequest(withNs(conn, `/connections/${conn.id}/objects`), [])
}

// Definition(s) of a function/routine by name (may return multiple overloads).
export async function getFunction(conn, name) {
  return safeRequest(withNs(conn, `/connections/${conn.id}/function/${encodeURIComponent(name)}`), [])
}

export async function tableRowCount(conn, table) {
  const data: any = await getTableData(conn, table, 1)
  return data.rowCount !== undefined ? data.rowCount : 0
}

export async function getTableData(conn, table, limit = 200) {
  try {
    const data = await request<any>(withNs(conn, `/connections/${conn.id}/table/${table}?limit=${limit}`))
    return { columns: data.columns || [], rows: data.rows || [], error: data.error }
  } catch (error) {
    return { columns: [], rows: [], error: (error as Error)?.message }
  }
}

export async function getColumns(conn, table) {
  return safeRequest(withNs(conn, `/connections/${conn.id}/columns/${encodeURIComponent(table)}`), [])
}

export async function getSchema(conn) {
  return safeRequest(withNs(conn, `/connections/${conn.id}/schema`), {})
}

export async function getIndexes(conn, table) {
  return safeRequest(withNs(conn, `/connections/${conn.id}/indexes/${encodeURIComponent(table)}`), [])
}

export async function getTypes(conn) {
  // A schema designed from scratch has a dialect but no connection to ask, so
  // there is no request to make — the caller's static per-dialect list stands.
  if (!conn?.id) return []
  const data = await safeRequest<any>(`/connections/${conn.id}/types`, { types: [] })
  return data.types || []
}

export async function getNamespaces(conn, database?) {
  const base = `/connections/${conn.id}/namespaces`
  const path = database ? `${base}?database=${encodeURIComponent(database)}` : base
  // Server also returns `currentDatabase`; keep the type open for callers.
  return safeRequest<any>(path, { databases: [], schemas: [] })
}

// `strict` throws instead of degrading to an empty schema. A caller that only
// *draws* the answer wants the quiet version — an empty canvas is a fine way to
// say "couldn't read it". A caller that *stores* it does not: writing an empty
// schema over a good one loses the diagram, so the schema editor's Sync asks
// for the error and keeps what it had.
export async function getDiagram(conn, { strict = false }: { strict?: boolean } = {}) {
  // Same as getTypes: no connection means no live schema to draw — the canvas
  // starts empty rather than asking for /connections/null/diagram.
  if (!conn?.id) return { tables: [], foreignKeys: [] }
  const path = withNs(conn, `/connections/${conn.id}/diagram`)
  if (strict) return request<any>(path)
  return safeRequest(path, { tables: [], foreignKeys: [] })
}

export async function insertRow(conn, table, values) {
  try {
    return await request(`/connections/${conn.id}/insert`, { method: 'POST', body: { table, values, ...nsBody(conn) } })
  } catch (error) {
    return { error: (error as Error)?.message || 'Insert failed' }
  }
}

// `timeoutMs` (optional) aborts the request client-side once it elapses,
// surfacing a timeout error instead of hanging on a slow/runaway query.
export async function runQuery(conn, sql, { timeoutMs }: { timeoutMs?: number } = {}) {
  const controller = timeoutMs ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    return await request(`/connections/${conn.id}/query`, {
      method: 'POST',
      body: { sql, ...nsBody(conn) },
      signal: controller?.signal,
    })
  } catch (error) {
    if (controller?.signal.aborted) return { error: `Query timed out after ${Math.round((timeoutMs ?? 0) / 1000)}s` }
    return { error: (error as Error)?.message || 'Query failed' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// Analyze a query's performance (EXPLAIN-based, dialect-normalized). Unlike
// runQuery this throws on failure — the AnalyzePanel shows one error state.
export async function analyzeQuery(conn, sql) {
  return request<any>(`/connections/${conn.id}/analyze`, { method: 'POST', body: { sql, ...nsBody(conn) } })
}

// Record a successfully-executed DDL batch (already run via runQuery above) —
// bumps the connection's schema version and appends one migration row.
export async function recordSchemaMigration(conn, statements) {
  return request<any>(`/connections/${conn.id}/schema/migrations`, { method: 'POST', body: { statements } })
}

export async function listSchemaMigrations(conn) {
  return safeRequest(`/connections/${conn.id}/schema/migrations`, [])
}

// Roll the schema back to `toVersion` — runs the down SQL for every active
// migration newer than it, marks them 'rollbacked', and resets the connection's
// schema version. Returns { version, rolledBack }.
export async function rollbackSchema(conn, toVersion) {
  return request<any>(`/connections/${conn.id}/schema/rollback`, {
    method: 'POST',
    body: { toVersion, ...nsBody(conn) },
  })
}
