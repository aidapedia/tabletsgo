/**
 * SQLite driver.
 *
 * Implements the generic driver contract described in server/db/index.js. Every
 * method takes the stored connection plus a `ctx` ({ database, schema }) that
 * SQLite has no use for — a SQLite connection is exactly one file.
 */

import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import {
  ROW_ID_COLUMN,
  extractQueryColumns,
  makeIndexSuggestion,
  queryLevelSuggestions,
  quoteIdent,
} from './sql.js'

// One open handle per file path, shared by every connection pointing at it.
const handles = new Map()

function openDb(filepath) {
  if (!handles.has(filepath)) handles.set(filepath, new Database(filepath))
  return handles.get(filepath)
}

const dbFor = (conn) => openDb(conn.filepath)

export const sqliteDriver = {
  type: 'sqlite',
  label: 'SQLite',
  dataTypes: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'],

  // ---- Lifecycle ----
  async testConnection(config) {
    const db = new Database(config.filepath)
    try {
      const tables = listTables(db)
      return { ok: true, message: `Connected! ${tables.length} table(s) found.` }
    } finally {
      db.close()
    }
  },

  // Opened eagerly at boot so the first query doesn't pay for it.
  prewarm(conn) {
    if (conn.filepath) openDb(conn.filepath)
  },

  // Drop the cached handle so the next call reopens the file (after an edit to
  // `filepath`, or a restore that replaced the file underneath us). The old
  // handle is left for GC rather than closed, since an in-flight request may
  // still be holding it.
  release(conn) {
    if (conn.filepath) handles.delete(conn.filepath)
  },

  closeAll() {
    for (const [, db] of handles) db.close()
    handles.clear()
  },

  // ---- Introspection ----
  ping(conn) {
    dbFor(conn).prepare('SELECT 1').get()
    return { ok: true }
  },

  namespaces(conn) {
    const name = path.basename(conn.filepath || 'database')
    return { databases: [name], schemas: ['main'], currentDatabase: name }
  },

  listTables: (conn) => listTables(dbFor(conn)),

  // Generic database-object list: [{ name, type }] where type is 'table' | 'view'
  // | 'function' | … . SQLite exposes tables and views (no listable functions).
  listObjects: (conn) =>
    dbFor(conn)
      .prepare(
        `SELECT name, type FROM sqlite_master
         WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
         ORDER BY type, name`
      )
      .all()
      .map((r) => ({ name: r.name, type: r.type })),

  getTableData(conn, ctx, { table, limit = 200 }) {
    const db = dbFor(conn)
    try {
      const columns = db.prepare(`PRAGMA table_info("${table}")`).all()
      const columnNames = columns.map((c) => c.name)

      let rows = null
      if (!columns.some((c) => c.pk)) {
        // WITHOUT ROWID tables and views have no rowid — fall through to a plain read.
        try {
          rows = db.prepare(`SELECT rowid AS "${ROW_ID_COLUMN}", * FROM "${table}" LIMIT ${limit}`).all()
        } catch {
          rows = null
        }
      }
      if (!rows) rows = db.prepare(`SELECT * FROM "${table}" LIMIT ${limit}`).all()
      return { columns: columnNames, rows }
    } catch (error) {
      return { columns: [], rows: [], error: error.message }
    }
  },

  getColumns: (conn, ctx, table) => getColumns(dbFor(conn), table),

  getIndexes: (conn, ctx, table) => getIndexes(dbFor(conn), table),

  getSchemaMap(conn) {
    const db = dbFor(conn)
    const schema = {}
    for (const t of listTables(db)) schema[t] = getColumns(db, t).map((c) => c.name)
    return schema
  },

  getDiagram(conn) {
    const db = dbFor(conn)
    const tables = []
    const foreignKeys = []
    for (const t of listTables(db)) {
      tables.push({ name: t, columns: getColumns(db, t) })
      for (const fk of db.prepare(`PRAGMA foreign_key_list("${t}")`).all()) {
        foreignKeys.push({ table: t, column: fk.from, refTable: fk.table, refColumn: fk.to, onDelete: fk.on_delete, onUpdate: fk.on_update })
      }
    }
    return { tables, foreignKeys }
  },

  // ---- Data ----
  insertRow(conn, ctx, { table, values }) {
    const cols = Object.keys(values)
    const colList = cols.map((c) => `"${c}"`).join(', ')
    const sql = `INSERT INTO "${table}" (${colList}) VALUES (${cols.map(() => '?').join(', ')})`
    // better-sqlite3 can only bind numbers/strings/bigints/buffers/null.
    const params = cols.map((c) => {
      const v = values[c]
      if (typeof v === 'boolean') return v ? 1 : 0
      return v === undefined ? null : v
    })
    const info = dbFor(conn).prepare(sql).run(...params)
    return { ok: true, changes: info.changes, lastInsertRowid: info.lastInsertRowid }
  },

  runQuery: (conn, ctx, sql) => runQuery(dbFor(conn), sql),

  analyze: (conn, ctx, { sql, cls }) => analyze(dbFor(conn), sql, cls),

  // ---- Backup / restore ----
  // better-sqlite3's online backup API — safe against a half-written page,
  // unlike a raw fs.copyFile of the live database file.
  dump: (conn, destPath) => dbFor(conn).backup(destPath),

  async restore(conn, dumpPath) {
    if (!isSqliteFile(dumpPath)) {
      throw new Error('The file is not a SQLite database — refusing to overwrite the live database with it.')
    }
    handles.delete(conn.filepath)
    const swap = `${conn.filepath}.tmp`
    fs.copyFileSync(dumpPath, swap)
    fs.renameSync(swap, conn.filepath) // atomic replace of the live file
  },
}

// ---- Internals -------------------------------------------------------------

function listTables(db) {
  return db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`
    )
    .all()
    .map((r) => r.name)
}

function getColumns(db, table) {
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all()
  // Map each FK column to its referenced table/column.
  const fkMap = {}
  for (const fk of db.prepare(`PRAGMA foreign_key_list("${table}")`).all()) {
    fkMap[fk.from] = { table: fk.table, column: fk.to }
  }
  // SQLite auto-assigns only the rowid alias: the sole PK column declared
  // exactly INTEGER, on a table that has a rowid. That reads as no default in
  // PRAGMA table_info, so it has to be derived. The AUTOINCREMENT keyword is a
  // rowid-reuse policy on that same column, not a separate case.
  const ddl = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)?.sql || ''
  const withoutRowid = /WITHOUT\s+ROWID/i.test(ddl)
  const pkCols = cols.filter((c) => c.pk)
  const rowidAlias =
    !withoutRowid && pkCols.length === 1 && /^integer$/i.test((pkCols[0].type || '').trim()) ? pkCols[0].name : null
  return cols.map((c) => ({
    name: c.name,
    type: c.type || '',
    notnull: !!c.notnull,
    pk: !!c.pk,
    default: c.dflt_value,
    autoIncrement: c.name === rowidAlias,
    references: fkMap[c.name] || null,
  }))
}

function getIndexes(db, table) {
  return db
    .prepare(`PRAGMA index_list("${table}")`)
    .all()
    .map((idx) => {
      const cols = db.prepare(`PRAGMA index_info("${idx.name}")`).all().map((c) => c.name)
      return {
        name: idx.name,
        algorithm: 'BTREE',
        unique: !!idx.unique,
        columns: cols.join(', '),
        condition: idx.partial ? '(partial)' : '',
        include: '',
        comment: '',
      }
    })
}

function runQuery(db, sql) {
  try {
    const stmt = db.prepare(sql)
    // `reader` is true for any statement that returns rows — SELECT, EXPLAIN,
    // EXPLAIN QUERY PLAN, PRAGMA, VALUES, WITH … SELECT — not just SELECT.
    if (stmt.reader) {
      const rows = stmt.all()
      const columns = stmt.columns().map((c) => c.name)
      return { type: 'rows', columns, rows }
    }
    const result = stmt.run()
    return { type: 'message', message: `Query OK · ${result.changes} row(s) affected.`, rowCount: result.changes }
  } catch (error) {
    return { error: error.message }
  }
}

// True if the file starts with the SQLite magic header — keeps restore from
// overwriting a live database with a file that isn't a SQLite database at all.
function isSqliteFile(filePath) {
  const buf = Buffer.alloc(16)
  const fd = fs.openSync(filePath, 'r')
  const n = fs.readSync(fd, buf, 0, 16, 0)
  fs.closeSync(fd)
  return n === 16 && buf.toString('utf8', 0, 15) === 'SQLite format 3'
}

// ---- Query analyzer --------------------------------------------------------
// EXPLAIN QUERY PLAN, normalized into the dialect-agnostic shape described in
// server/db/index.js. Read-only SELECTs are additionally executed for real
// timings; anything else stays estimate-only so analysis never modifies data.
async function analyze(db, sql, cls) {
  const eqp = runQuery(db, `EXPLAIN QUERY PLAN ${sql}`)
  if (eqp.error) throw new Error(eqp.error)

  // Normalize plan rows. Modern sqlite emits id/parent/notused/detail; older
  // builds emit selectid/order/from/detail — read `detail` by name with a
  // last-column fallback and compute depth from id/parent when available.
  const depthById = new Map()
  const plan = (eqp.rows || []).map((r) => {
    const detail = r.detail ?? Object.values(r)[Object.values(r).length - 1] ?? ''
    let depth = 0
    if (r.id !== undefined && r.parent !== undefined) {
      depth = r.parent === 0 ? 0 : (depthById.get(r.parent) ?? 0) + 1
      depthById.set(r.id, depth)
    }
    const row = { depth, step: '', detail: String(detail), table: null, index: null, rows: null, warning: null }

    let m
    if ((m = /^SCAN\s+("?[\w]+"?)(?:\s+AS\s+\S+)?(\s+USING\s+(?:COVERING\s+)?INDEX\s+(\S+))?/i.exec(detail))) {
      row.step = 'SCAN'
      row.table = m[1].replace(/^"|"$/g, '')
      if (m[3]) row.index = m[3]
      else if (!/USING INTEGER PRIMARY KEY/i.test(detail)) row.warning = 'Full table scan'
    } else if ((m = /^SEARCH\s+("?[\w]+"?)(?:\s+AS\s+\S+)?\s+USING\s+(?:COVERING\s+)?INDEX\s+(\S+)/i.exec(detail))) {
      row.step = 'SEARCH'
      row.table = m[1].replace(/^"|"$/g, '')
      row.index = m[2]
    } else if (/^SEARCH\s+/i.test(detail)) {
      row.step = 'SEARCH'
      row.table = /^SEARCH\s+("?[\w]+"?)/i.exec(detail)?.[1]?.replace(/^"|"$/g, '') || null
    } else if (/USE TEMP B-TREE FOR (ORDER BY|GROUP BY|DISTINCT)/i.test(detail)) {
      row.step = 'SORT'
      row.warning = 'Sort without index (temp B-tree)'
    } else {
      row.step = detail.split(/\s+/)[0]?.toUpperCase() || ''
    }
    return row
  })

  // Real timing for read-only SELECTs only.
  let summary = { mode: 'estimated', executed: false }
  if (cls.kind === 'select' && cls.readOnly) {
    const t0 = performance.now()
    const run = runQuery(db, sql)
    const elapsedMs = Math.round((performance.now() - t0) * 100) / 100
    if (run.error) throw new Error(run.error)
    summary = { mode: 'actual', executed: true, elapsedMs, rowsReturned: run.rows?.length ?? 0 }
  }

  // Index suggestions from full scans / temp-btree sorts.
  const { where, orderBy } = extractQueryColumns(sql)
  const indexSuggestions = []
  const columnsByTable = new Map()
  const colsFor = (table) => {
    if (!columnsByTable.has(table)) {
      try {
        columnsByTable.set(table, getColumns(db, table))
      } catch {
        columnsByTable.set(table, [])
      }
    }
    return columnsByTable.get(table)
  }
  const scannedTables = [...new Set(plan.filter((p) => p.warning === 'Full table scan' && p.table).map((p) => p.table))]
  for (const table of scannedTables) {
    const sug = makeIndexSuggestion(
      table, where, colsFor(table), getIndexes(db, table),
      `Full table scan on ${quoteIdent(table)} while filtering — an index on the filtered column(s) would let SQLite seek instead of scan.`
    )
    if (sug) indexSuggestions.push(sug)
  }
  if (plan.some((p) => p.warning === 'Sort without index (temp B-tree)') && orderBy.length) {
    // Attribute the sort to the first scanned/searched table.
    const table = plan.find((p) => p.table)?.table
    if (table) {
      const sug = makeIndexSuggestion(
        table, orderBy, colsFor(table), getIndexes(db, table),
        `ORDER BY builds a temporary B-tree — an index on the sort column(s) delivers rows pre-sorted.`
      )
      if (sug && !indexSuggestions.some((s) => s.ddl === sug.ddl)) indexSuggestions.push(sug)
    }
  }

  const primaryTable = plan.find((p) => p.table)?.table
  const querySuggestions = queryLevelSuggestions(sql, plan, primaryTable ? colsFor(primaryTable).length : 0)

  return {
    dialect: 'sqlite',
    summary,
    plan,
    rawPlan: { columns: eqp.columns, rows: eqp.rows },
    indexSuggestions,
    querySuggestions,
  }
}
