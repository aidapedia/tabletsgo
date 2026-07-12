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
  const data = await safeRequest<any>(`/connections/${conn.id}/types`, { types: [] })
  return data.types || []
}

export async function getNamespaces(conn, database?) {
  const base = `/connections/${conn.id}/namespaces`
  const path = database ? `${base}?database=${encodeURIComponent(database)}` : base
  // Server also returns `currentDatabase`; keep the type open for callers.
  return safeRequest<any>(path, { databases: [], schemas: [] })
}

export async function getDiagram(conn) {
  return safeRequest(withNs(conn, `/connections/${conn.id}/diagram`), { tables: [], foreignKeys: [] })
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
