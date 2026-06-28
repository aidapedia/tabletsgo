/**
 * Database layer that communicates with the backend server
 * for real SQLite and PostgreSQL connections
 */

const API_URL = '/api'

// A connection may carry a selected namespace `ns: { database, schema }` so
// requests can browse other databases/schemas on the same connection.
function nsParams(conn) {
  const p = new URLSearchParams()
  if (conn?.ns?.database) p.set('database', conn.ns.database)
  if (conn?.ns?.schema) p.set('schema', conn.ns.schema)
  return p
}
function withNs(conn, base) {
  const p = nsParams(conn)
  const qs = p.toString()
  return qs ? `${base}${base.includes('?') ? '&' : '?'}${qs}` : base
}
const nsBody = (conn) => ({ database: conn?.ns?.database, schema: conn?.ns?.schema })

export async function getDb(conn) {
  // Return the connection object - actual queries are made via API
  return conn
}

export async function listTables(conn) {
  try {
    const res = await fetch(withNs(conn, `${API_URL}/connections/${conn.id}/tables`))
    if (res.ok) {
      return await res.json()
    }
  } catch (error) {
    console.error('Failed to list tables:', error)
  }
  return []
}

export async function tableRowCount(conn, table) {
  try {
    const data = await getTableData(conn, table, 1)
    return data.rowCount !== undefined ? data.rowCount : 0
  } catch (error) {
    return 0
  }
}

export async function getTableData(conn, table, limit = 200) {
  try {
    const res = await fetch(withNs(conn, `${API_URL}/connections/${conn.id}/table/${table}?limit=${limit}`))
    if (res.ok) {
      const data = await res.json()
      return { columns: data.columns || [], rows: data.rows || [], error: data.error }
    }
  } catch (error) {
    console.error('Failed to get table data:', error)
  }
  return { columns: [], rows: [], error: error?.message }
}

export async function getColumns(conn, table) {
  try {
    const res = await fetch(withNs(conn, `${API_URL}/connections/${conn.id}/columns/${encodeURIComponent(table)}`))
    if (res.ok) return await res.json()
  } catch (error) {
    console.error('Failed to get columns:', error)
  }
  return []
}

export async function getSchema(conn) {
  try {
    const res = await fetch(withNs(conn, `${API_URL}/connections/${conn.id}/schema`))
    if (res.ok) return await res.json()
  } catch (error) {
    console.error('Failed to get schema:', error)
  }
  return {}
}

export async function getNamespaces(conn, database) {
  try {
    const base = `${API_URL}/connections/${conn.id}/namespaces`
    const url = database ? `${base}?database=${encodeURIComponent(database)}` : base
    const res = await fetch(url)
    if (res.ok) return await res.json()
  } catch (error) {
    console.error('Failed to get namespaces:', error)
  }
  return { databases: [], schemas: [] }
}

export async function getDiagram(conn) {
  try {
    const res = await fetch(withNs(conn, `${API_URL}/connections/${conn.id}/diagram`))
    if (res.ok) return await res.json()
  } catch (error) {
    console.error('Failed to get diagram:', error)
  }
  return { tables: [], foreignKeys: [] }
}

export async function insertRow(conn, table, values) {
  try {
    const res = await fetch(`${API_URL}/connections/${conn.id}/insert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, values, ...nsBody(conn) }),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error || 'Insert failed' }
    return data
  } catch (error) {
    return { error: error.message }
  }
}

export async function runQuery(conn, sql) {
  try {
    const res = await fetch(`${API_URL}/connections/${conn.id}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, ...nsBody(conn) }),
    })
    if (res.ok) {
      return await res.json()
    } else {
      const error = await res.json()
      return { error: error.error || 'Query failed' }
    }
  } catch (error) {
    return { error: error.message }
  }
}
