/**
 * Table data export / import — the console's Export and Import panel.
 *
 * Not to be confused with ./connection-transfer.js, which moves a connection's
 * *configuration*; this moves the rows inside its tables. Three formats:
 *
 *   csv   one table per file: a header row, then one line per row
 *   json  a `tabletsgo.data` document holding any number of tables (and, when
 *         asked, the DDL that recreates them); a bare array of row objects or a
 *         `{ table: [rows] }` map imports too
 *
 * An import needs nothing but the file: see parseImport.
 *   sql   CREATE TABLE/INDEX (when asked) followed by one INSERT per row
 *
 * Everything here is engine-agnostic: rows are read through `getTableData`
 * pages, written through `insertRows`/`runScript`, and the schema comes from
 * `tableDdl` — so a new engine gets export/import by implementing those ops.
 * An engine without tables (Redis) lists none, so there is nothing to export.
 */

import * as db from './db/index.js'
import { quoteIdent, splitSqlStatements, stripSqlComments } from './db/sql.js'

export const DATA_FORMAT = 'tabletsgo.data'
export const DATA_FORMAT_VERSION = 1
export const IMPORT_MAX_BYTES = 50 * 1024 * 1024
export const PREVIEW_ROWS = 50
const PAGE_SIZE = 1000

const FORMATS = {
  csv: { ext: 'csv', mime: 'text/csv; charset=utf-8' },
  json: { ext: 'json', mime: 'application/json; charset=utf-8' },
  sql: { ext: 'sql', mime: 'application/sql; charset=utf-8' },
}

const badInput = (message) => Object.assign(new Error(message), { status: 400 })

// ---- Value encoding ---------------------------------------------------------
// Bytes travel as `\x…` hex text — what Postgres reads back into bytea, and
// unambiguous everywhere else. BigInts as strings, since JSON can't hold them.
function plainValue(v) {
  if (v === undefined) return null
  if (Buffer.isBuffer(v)) return `\\x${v.toString('hex')}`
  if (typeof v === 'bigint') return String(v)
  return v
}

function csvCell(v) {
  v = plainValue(v)
  if (v === null) return ''
  const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// ---- Reading ----------------------------------------------------------------

// Every row of `table` (or the first `limit`), a page at a time. Rows are
// projected onto the table's columns, which drops the hidden row-id field.
async function* tablePages(conn, ctx, table, limit) {
  let offset = 0
  while (true) {
    const size = limit ? Math.min(PAGE_SIZE, limit - offset) : PAGE_SIZE
    if (size <= 0) return
    const page = await db.getTableData(conn, ctx, { table, limit: size, offset })
    if (page.error) throw new Error(`Reading "${table}" failed: ${page.error}`)
    const rows = page.rows.map((r) => Object.fromEntries(page.columns.map((c) => [c, r[c]])))
    yield { columns: page.columns, rows }
    if (rows.length < size) return
    offset += rows.length
  }
}

// Parents before children, so a replayed export never inserts a row before the
// row its foreign key points at. Cycles keep their selection order.
async function orderByDependencies(conn, ctx, tables) {
  if (tables.length < 2) return tables
  const deps = new Map()
  for (const t of tables) {
    const cols = await db.getColumns(conn, ctx, t)
    deps.set(t, new Set(cols.map((c) => c.references?.table).filter((r) => r && r !== t && tables.includes(r))))
  }
  const out = []
  const visiting = new Set()
  const visit = (t) => {
    if (out.includes(t) || visiting.has(t)) return
    visiting.add(t)
    for (const d of deps.get(t)) visit(d)
    out.push(t)
  }
  tables.forEach(visit)
  return out
}

// ---- Export -----------------------------------------------------------------

async function* csvChunks(conn, ctx, [table], { limit }) {
  let header = false
  for await (const { columns, rows } of tablePages(conn, ctx, table, limit)) {
    if (!header) {
      yield `${columns.map(csvCell).join(',')}\n`
      header = true
    }
    if (rows.length) yield `${rows.map((r) => columns.map((c) => csvCell(r[c])).join(',')).join('\n')}\n`
  }
}

async function* jsonChunks(conn, ctx, tables, { includeSchema, limit }) {
  const head = { format: DATA_FORMAT, version: DATA_FORMAT_VERSION, exportedAt: new Date().toISOString(), source: { type: conn.type } }
  yield `${JSON.stringify(head, null, 2).slice(0, -2)},\n  "tables": [`
  for (const [i, table] of tables.entries()) {
    const ddl = includeSchema ? await db.tableDdl(conn, ctx, table) : null
    const open = (columns) => `${i ? ',' : ''}\n    ${JSON.stringify({ name: table, ...(ddl ? { ddl } : {}), columns }).slice(0, -1)},"rows":[`
    let opened = false
    let first = true
    for await (const { columns, rows } of tablePages(conn, ctx, table, limit)) {
      if (!opened) {
        yield open(columns)
        opened = true
      }
      for (const r of rows) {
        yield `${first ? '' : ','}\n      ${JSON.stringify(Object.fromEntries(columns.map((c) => [c, plainValue(r[c])])))}`
        first = false
      }
    }
    if (!opened) yield open([])
    yield `${first ? '' : '\n    '}]}`
  }
  yield '\n  ]\n}\n'
}

async function* sqlChunks(conn, ctx, tables, { includeSchema, limit }) {
  const literal = db.literalFor(conn)
  yield `-- ${DATA_FORMAT} v${DATA_FORMAT_VERSION} · ${conn.type} · ${new Date().toISOString()}\n`
  if (includeSchema) {
    for (const table of tables) {
      const ddl = await db.tableDdl(conn, ctx, table)
      if (ddl.length) yield `\n-- Schema: ${table}\n${ddl.join('\n')}\n`
    }
  }
  for (const table of tables) {
    yield `\n-- Data: ${table}\n`
    for await (const { columns, rows } of tablePages(conn, ctx, table, limit)) {
      if (!rows.length) continue
      const cols = columns.map(quoteIdent).join(', ')
      yield `${rows
        .map((r) => `INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${columns.map((c) => literal(r[c])).join(', ')});`)
        .join('\n')}\n`
    }
  }
}

const slug = (s) => String(s || 'export').replace(/[^\w.-]+/g, '_').slice(0, 60)

/**
 * Validate an export request and return how to serve it: `chunks` is an async
 * iterable of text the route streams straight into the response, so a large
 * table never sits in memory. Everything that can be refused is refused here,
 * before a header is sent.
 *
 * `limit` caps the rows per table — the panel's preview uses it.
 */
export async function planExport(conn, ctx, { tables, format, includeSchema = false, limit = 0 }) {
  const spec = FORMATS[format]
  if (!spec) throw badInput(`Unknown export format "${format}" — use csv, json or sql.`)
  if (!tables?.length) throw badInput('Pick at least one table to export.')
  if (format === 'csv' && tables.length > 1) throw badInput('A CSV file holds one table — export the tables one at a time.')
  // Table names are interpolated (quoted) into the reads, so only names the
  // database itself reports are accepted.
  const known = new Set(await db.listTables(conn, ctx))
  const unknown = tables.filter((t) => !known.has(t))
  if (unknown.length) throw badInput(`Unknown table${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`)

  const ordered = format === 'csv' ? tables : await orderByDependencies(conn, ctx, tables)
  const opts = { includeSchema: !!includeSchema, limit: Math.max(0, parseInt(limit) || 0) }
  const chunks =
    format === 'csv' ? csvChunks(conn, ctx, ordered, opts) : format === 'json' ? jsonChunks(conn, ctx, ordered, opts) : sqlChunks(conn, ctx, ordered, opts)
  const stamp = new Date().toISOString().slice(0, 10)
  const base = tables.length === 1 ? tables[0] : conn.name
  return { mime: spec.mime, filename: `${slug(base)}-${stamp}.${spec.ext}`, chunks }
}

// ---- Import -----------------------------------------------------------------

// RFC 4180: quoted fields may hold commas, quotes ("") and line breaks.
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '')
}

// The table a file's rows go into when nothing names one: the file's own name,
// minus the extension and the date stamp an export adds (`users-2026-10-02.csv`).
export function tableFromFilename(filename) {
  const base = String(filename || '')
    .split(/[\\/]/)
    .pop()
    .replace(/\.[^.]+$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
    .trim()
  return base || 'imported'
}

// The file's format: what the caller says, else its extension, else a sniff of
// the content — JSON opens with a bracket, SQL with a keyword, anything else
// is read as CSV.
export function detectFormat(filename, text, explicit) {
  if (FORMATS[explicit]) return explicit
  const ext = String(filename || '').split('.').pop()?.toLowerCase()
  if (FORMATS[ext]) return ext
  const head = text.trimStart()
  if (/^[[{]/.test(head)) return 'json'
  if (/^(--|\/\*|(CREATE|INSERT|BEGIN|DROP|ALTER|UPDATE|DELETE|SET|WITH|PRAGMA)\b)/i.test(head)) return 'sql'
  return 'csv'
}

// ---- Column types for a table the file creates ------------------------------
// Portable SQL type names every supported engine reads (SQLite by affinity), so
// a table can be created from CSV/JSON with no engine branch. CSV cells are all
// text, so they're classified by what they look like; JSON values by their type.
const INT32 = 2147483647
function kindOf(v, fromText) {
  if (typeof v === 'boolean' || (fromText && (v === 'true' || v === 'false'))) return 'bool'
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'num'
  // No leading zeros: `007` is an identifier (a zip code, a phone number), not 7.
  if (fromText && /^-?(0|[1-9]\d{0,17})$/.test(v)) return 'int'
  if (fromText && /^-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?$/.test(v)) return 'num'
  return 'text'
}

function inferType(values, fromText) {
  const present = values.filter((v) => v !== null && v !== undefined)
  if (!present.length) return 'TEXT'
  const kinds = new Set(present.map((v) => kindOf(v, fromText)))
  if (kinds.size === 1 && kinds.has('bool')) return 'BOOLEAN'
  if (kinds.size === 1 && kinds.has('int')) return present.some((v) => Math.abs(Number(v)) > INT32) ? 'BIGINT' : 'INTEGER'
  if ([...kinds].every((k) => k === 'int' || k === 'num')) return 'DOUBLE PRECISION'
  return 'TEXT'
}

// A CSV cell as the value its inferred column type holds.
function coerce(v, type) {
  if (v === null || typeof v !== 'string') return v
  if (type === 'BOOLEAN') return v === 'true'
  if (type === 'DOUBLE PRECISION') return Number(v)
  if (type === 'INTEGER' || type === 'BIGINT') return Number.isSafeInteger(Number(v)) ? Number(v) : v
  return v
}

function inferredSchema(t, fromText) {
  const types = Object.fromEntries(t.columns.map((c) => [c, inferType(t.rows.map((r) => r[c]), fromText)]))
  const cols = t.columns.map((c) => `${quoteIdent(c)} ${types[c]}`).join(',\n  ')
  return { types, ddl: [`CREATE TABLE IF NOT EXISTS ${quoteIdent(t.table)} (\n  ${cols}\n);`] }
}

// ---- Parsing ------------------------------------------------------------------

function csvTables(text, table) {
  const [header, ...lines] = parseCsv(text)
  if (!header?.length) throw badInput('The CSV file is empty.')
  // CSV can't tell an empty string from NULL; an empty cell is read as NULL,
  // which is also how the export writes one.
  const rows = lines.map((l) => Object.fromEntries(header.map((c, i) => [c, l[i] === undefined || l[i] === '' ? null : l[i]])))
  return [{ table, columns: header, rows }]
}

function jsonTables(text, table) {
  let doc
  try {
    doc = JSON.parse(text)
  } catch (error) {
    throw badInput(`The file is not valid JSON: ${error.message}`)
  }
  const columnsOf = (rows) => [...new Set(rows.flatMap((r) => Object.keys(r || {})))]
  const asRows = (rows, name) => {
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
      throw badInput(`"${name}" must be a list of row objects.`)
    }
    return rows
  }
  if (Array.isArray(doc)) {
    const rows = asRows(doc, table)
    return { source: null, tables: [{ table, columns: columnsOf(rows), rows }] }
  }
  if (doc && Array.isArray(doc.tables)) {
    return {
      source: doc.source?.type || null,
      tables: doc.tables.map((t) => {
        if (!t?.name) throw badInput('Every table in the file needs a "name".')
        const rows = asRows(t.rows || [], t.name)
        return { table: t.name, columns: t.columns || columnsOf(rows), rows, ddl: Array.isArray(t.ddl) ? t.ddl : null }
      }),
    }
  }
  if (doc && typeof doc === 'object') {
    return { source: null, tables: Object.entries(doc).map(([name, rows]) => ({ table: name, columns: columnsOf(asRows(rows, name)), rows })) }
  }
  throw badInput('Expected a list of rows, a { table: [rows] } object, or a TabletsGo data export.')
}

/**
 * Read an import file into what it asks for. Nothing has to be said about it
 * but its name: the format comes from the extension (or the content), a CSV or
 * a bare JSON array goes into the table the file is named after, and every
 * table the file names that the database lacks gets a schema — the file's own
 * DDL when the same engine wrote it, else column types inferred from the rows.
 * An existing table matching a name in any letter case is the one used.
 */
async function parseImport(conn, ctx, { text, filename, format, table }) {
  const body = String(text || '').replace(/^\uFEFF/, '')
  if (!body.trim()) throw badInput('The file is empty.')
  const fmt = detectFormat(filename, body, format)
  if (fmt === 'sql') return { format: fmt, kind: 'script', sql: body }

  const target = table || tableFromFilename(filename)
  const { source, tables } = fmt === 'csv' ? { source: null, tables: csvTables(body, target) } : jsonTables(body, target)
  const known = await db.listTables(conn, ctx)
  const byLower = new Map(known.map((t) => [t.toLowerCase(), t]))
  return {
    format: fmt,
    kind: 'rows',
    tables: tables.map((t) => {
      const existing = known.includes(t.table) ? t.table : byLower.get(t.table.toLowerCase())
      if (existing) return { ...t, table: existing, exists: true }
      const own = t.ddl?.length && source === conn.type
      return { ...t, exists: false, ...(own ? { ddl: t.ddl, types: null } : inferredSchema(t, fmt === 'csv')), schemaFrom: own ? 'file' : 'inferred' }
    }),
  }
}

const statementCount = (sql) => splitSqlStatements(stripSqlComments(sql)).length

/**
 * What an import would do, without writing anything: the tables it targets,
 * how many rows each, which exist and the schema any missing one would get,
 * and a few rows to show. A SQL script reports its statement count and
 * opening lines.
 */
export async function previewImport(conn, ctx, opts) {
  const parsed = await parseImport(conn, ctx, opts)
  if (parsed.kind === 'script') {
    return { format: parsed.format, kind: 'script', statements: statementCount(parsed.sql), sample: parsed.sql.slice(0, 8000) }
  }
  return {
    format: parsed.format,
    kind: 'rows',
    tables: parsed.tables.map((t) => ({
      table: t.table,
      columns: t.columns,
      total: t.rows.length,
      rows: t.rows.slice(0, PREVIEW_ROWS),
      exists: t.exists,
      ...(t.exists ? {} : { schemaFrom: t.schemaFrom, ddl: t.ddl, types: t.types }),
    })),
  }
}

/**
 * Write an import. Missing tables are created first (unless `createTables` is
 * false, which refuses instead); then rows land table by table, each table in
 * one transaction — an error rolls that table back and stops the import. A SQL
 * script runs whole in one.
 */
export async function runImport(conn, ctx, { createTables = true, ...opts }) {
  const parsed = await parseImport(conn, ctx, opts)
  if (parsed.kind === 'script') {
    await db.runScript(conn, ctx, parsed.sql)
    return { format: parsed.format, kind: 'script', statements: statementCount(parsed.sql) }
  }
  db.requireCapability(conn, 'insertRows')
  const missing = parsed.tables.filter((t) => !t.exists)
  if (missing.length && !createTables) {
    throw badInput(`No such table${missing.length > 1 ? 's' : ''}: ${missing.map((t) => t.table).join(', ')} — create ${missing.length > 1 ? 'them' : 'it'} first.`)
  }
  for (const t of missing) {
    await db.runScript(conn, ctx, t.ddl.join('\n'))
    // Typed values for the columns just typed from the data.
    if (t.types) t.rows = t.rows.map((r) => Object.fromEntries(Object.entries(r).map(([c, v]) => [c, coerce(v, t.types[c])])))
  }

  const results = []
  for (const t of parsed.tables) {
    if (!t.rows.length) {
      results.push({ table: t.table, inserted: 0 })
      continue
    }
    try {
      const r = await db.insertRows(conn, ctx, { table: t.table, rows: t.rows })
      results.push({ table: t.table, inserted: r.inserted })
    } catch (error) {
      const done = results.filter((r) => r.inserted).map((r) => `${r.table} (${r.inserted})`)
      throw badInput(`Importing "${t.table}" failed: ${error.message}${done.length ? ` — already imported: ${done.join(', ')}` : ''}`)
    }
  }
  return { format: parsed.format, kind: 'rows', created: missing.map((t) => t.table), tables: results }
}
