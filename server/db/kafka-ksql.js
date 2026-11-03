/**
 * ksqlDB, over its REST API (the connection's `ksqlUrl`). Statements (CREATE,
 * SHOW, DESCRIBE, DROP, TERMINATE, …) go to /ksql; a SELECT or PRINT goes to
 * /query-stream, read as newline-delimited rows.
 *
 * Every answer is the grid shape the rest of the app uses ({ type: 'rows',
 * columns, rows } | { type: 'message', message }). A push query (EMIT CHANGES)
 * never ends on its own, so a query is bounded like a topic read — by the Kafka
 * module's messages-per-read and read time limit — and reports whether it was
 * cut off. No query outlives its request.
 */

import { moduleSetting } from '../module-registry.js'
import { restRequest } from './kafka-rest.js'

const call = (conn, path, options = {}) => restRequest(conn, 'ksql', { path, ...options })

// Split on `;` outside quotes and comments; drop empty statements.
export function splitStatements(text) {
  const out = []
  let cur = ''
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (!quote && ch === '-' && text[i + 1] === '-') {
      while (i < text.length && text[i] !== '\n') i++
      cur += '\n'
      continue
    }
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '`' || ch === '"') quote = ch
    if (ch === ';') {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

const isQuery = (statement) => /^(SELECT|PRINT)\b/i.test(statement)

const cell = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v)
const rowsOf = (items) => {
  const columns = [...new Set(items.flatMap((i) => Object.keys(i)))]
  return { type: 'rows', columns, rows: items.map((i) => Object.fromEntries(columns.map((c) => [c, cell(i[c])]))) }
}

// One /ksql result entity → the grid shape.
function entityResult(e) {
  const statement = e.statementText || ''
  if (e.commandStatus) return { statement, type: 'message', message: e.commandStatus.message || e.commandStatus.status }
  if (e.sourceDescription) {
    const d = e.sourceDescription
    return {
      statement,
      ...rowsOf((d.fields || []).map((f) => ({ field: f.name, type: f.schema?.type, key: f.type === 'KEY' }))),
      message: `${d.type} ${d.name} · topic ${d.topic} · key ${d.keyFormat} · value ${d.valueFormat}`,
    }
  }
  if (e.queryDescription) {
    const q = e.queryDescription
    return { statement, ...rowsOf((q.fields || []).map((f) => ({ field: f.name, type: f.schema?.type }))), message: `${q.id?.id || q.id} · ${q.state || ''} · ${q.statementText || ''}` }
  }
  // Listings (streams, tables, queries, topics, properties, functions, connectors…):
  // the entity's one array of objects is the rows.
  const list = Object.entries(e).find(([k, v]) => k !== 'warnings' && Array.isArray(v) && (v.length === 0 || typeof v[0] === 'object'))
  if (list) return list[1].length ? { statement, ...rowsOf(list[1]) } : { statement, type: 'message', message: `(no ${list[0]})` }
  // A notice, e.g. IF NOT EXISTS finding the source already there.
  if (typeof e.message === 'string') return { statement, type: 'message', message: e.message }
  const { '@type': kind, statementText, warnings, ...rest } = e
  return { statement, type: 'message', message: Object.keys(rest).length ? JSON.stringify(rest) : kind || 'Done.' }
}

const clampLimit = (limit) => Math.min(Math.max(parseInt(limit) || 100, 1), moduleSetting('kafka', 'readMaxMessages'))

async function runQuery(conn, sql, { properties = {}, limit } = {}) {
  const take = clampLimit(limit)
  const lines = (text) => text.split('\n').filter((l) => l.trim())
  const started = Date.now()
  const { text, cut } = await call(conn, '/query-stream', {
    method: 'POST',
    body: { sql: `${sql};`, properties },
    headers: { accept: 'application/vnd.ksqlapi.delimited.v1' },
    // The header line, then one line per row.
    bounded: { maxMs: moduleSetting('kafka', 'readTimeoutMs'), enough: (t) => lines(t).length > take },
  })
  const [head, ...body] = lines(text)
  let header
  try {
    header = JSON.parse(head || '{}')
  } catch {
    header = {}
  }
  if (header['@type']?.includes('error') || header.error_code) throw Object.assign(new Error(header.message || 'ksqlDB refused the query.'), { status: 400 })
  const columns = header.columnNames || []
  const rows = []
  for (const line of body.slice(0, take)) {
    let v
    try {
      v = JSON.parse(line.replace(/,$/, ''))
    } catch {
      continue
    }
    if (!Array.isArray(v)) {
      // An error or a final message mid-stream.
      if (v?.message && (v['@type']?.includes('error') || v.error_code)) throw Object.assign(new Error(v.message), { status: 400 })
      continue
    }
    rows.push(Object.fromEntries(columns.map((c, i) => [c, cell(v[i])])))
  }
  return {
    type: 'rows',
    columns,
    rows,
    queryId: header.queryId || null,
    truncated: cut,
    cappedBy: cut ? (rows.length >= take ? 'rows' : 'time') : null,
    elapsedMs: Date.now() - started,
  }
}

/**
 * Run KSQL. Statements run together in one /ksql call, each answering with its
 * own result; a SELECT or PRINT has to be sent on its own. `properties` are
 * streams properties (e.g. auto.offset.reset=earliest).
 */
export async function runKsql(conn, { sql, properties = {}, limit } = {}) {
  const statements = splitStatements(String(sql || ''))
  if (!statements.length) throw Object.assign(new Error('No statement to run.'), { status: 400 })
  if (statements.some(isQuery)) {
    if (statements.length > 1) throw Object.assign(new Error('Run a SELECT or PRINT on its own — not together with other statements.'), { status: 400 })
    return { results: [{ statement: statements[0], ...(await runQuery(conn, statements[0], { properties, limit })) }] }
  }
  const entities = await call(conn, '/ksql', { method: 'POST', body: { ksql: statements.map((s) => `${s};`).join('\n'), streamsProperties: properties } }).catch((error) => {
    // A failed statement: ksqlDB names it in `statementText`.
    const failed = error.body?.statementText
    throw Object.assign(new Error(failed ? `${error.message}\n— in: ${failed}` : error.message), { status: error.status === 502 ? 502 : 400 })
  })
  return { results: (entities || []).map(entityResult) }
}

/** The streams, tables and running queries — the panel's sidebar. */
export async function ksqlCatalog(conn) {
  const entities = await call(conn, '/ksql', { method: 'POST', body: { ksql: 'SHOW STREAMS; SHOW TABLES; SHOW QUERIES;', streamsProperties: {} } })
  const of = (type) => entities?.find((e) => e['@type'] === type) || {}
  const isSystem = (name) => /^KSQL_PROCESSING_LOG$/i.test(name)
  return {
    streams: (of('streams').streams || []).map((s) => ({ name: s.name, topic: s.topic, keyFormat: s.keyFormat, valueFormat: s.valueFormat, system: isSystem(s.name) })),
    tables: (of('tables').tables || []).map((t) => ({ name: t.name, topic: t.topic, keyFormat: t.keyFormat, valueFormat: t.valueFormat, windowed: Boolean(t.isWindowed) })),
    queries: (of('queries').queries || []).map((q) => ({ id: q.id, state: q.state, sinks: q.sinks || [], statement: q.queryString })),
  }
}
