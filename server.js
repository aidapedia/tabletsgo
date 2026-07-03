#!/usr/bin/env node
/**
 * Backend server for database management
 * Handles SQLite and PostgreSQL connections
 */

import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID, createHash } from 'crypto'
import Database from 'better-sqlite3'
import pkg from 'pg'
const { Client, Pool } = pkg

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Live connection pools to the databases the user manages.
const sqliteConnections = new Map()
const postgresConnections = new Map()

// ============================================================================
// Metadata store — a local SQLite DB that persists app data: users,
// saved connections and saved queries. (Separate from the databases the
// user connects to.)
// ============================================================================

const META_DB_PATH = process.env.META_DB || path.join(__dirname, 'data', 'app.db')
fs.mkdirSync(path.dirname(META_DB_PATH), { recursive: true })
const meta = new Database(META_DB_PATH)
meta.pragma('journal_mode = WAL')

const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex')

function initMetaDb() {
  meta.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT
    );
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS saved_queries (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sql TEXT NOT NULL,
      kind TEXT,
      ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS saved_folders (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      name TEXT NOT NULL,
      ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS query_history (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      table_name TEXT,
      query TEXT NOT NULL,
      status TEXT NOT NULL,        -- 'success' | 'failed'
      latency INTEGER,             -- execution latency in ms
      error TEXT,
      executor_id TEXT,
      executor_name TEXT,
      ts INTEGER                   -- execution time (epoch ms)
    );
  `)
  // Migrate older DBs that predate the `kind` column.
  try {
    meta.prepare('SELECT kind FROM saved_queries LIMIT 1').get()
  } catch {
    meta.exec('ALTER TABLE saved_queries ADD COLUMN kind TEXT')
  }
  // Migrate older DBs that predate the `folder_id` column.
  try {
    meta.prepare('SELECT folder_id FROM saved_queries LIMIT 1').get()
  } catch {
    meta.exec('ALTER TABLE saved_queries ADD COLUMN folder_id TEXT')
  }

  // Seed the default admin user. Credentials are configurable via env so a
  // deploy can set a strong password instead of the built-in default.
  if (!meta.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    const adminUser = process.env.ADMIN_USERNAME || 'admin'
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123'
    meta
      .prepare('INSERT INTO users (id, username, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), adminUser, sha256(adminPass), 'Admin', 'admin')
    console.log(`🌱 Seeded default user: ${adminUser}`)
  }
}
initMetaDb()

// ---- Connection metadata helpers (DB-backed) ----
const listConnections = () =>
  meta.prepare('SELECT data FROM connections ORDER BY created_at').all().map((r) => JSON.parse(r.data))
const getConnection = (id) => {
  const row = meta.prepare('SELECT data FROM connections WHERE id = ?').get(id)
  return row ? JSON.parse(row.data) : null
}
const saveConnection = (conn) =>
  meta
    .prepare('INSERT OR REPLACE INTO connections (id, data, created_at) VALUES (?, ?, COALESCE((SELECT created_at FROM connections WHERE id = ?), ?))')
    .run(conn.id, JSON.stringify(conn), conn.id, Date.now())
const deleteConnectionRow = (id) => meta.prepare('DELETE FROM connections WHERE id = ?').run(id)

// ============================================================================
// SQLite Utilities
// ============================================================================

function getSqliteDb(path) {
  if (!sqliteConnections.has(path)) {
    sqliteConnections.set(path, new Database(path))
  }
  return sqliteConnections.get(path)
}

function listSqliteTables(db) {
  const res = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all()
  return res.map(r => r.name)
}

// Generic database-object list: [{ name, type }] where type is 'table' | 'view'
// | 'function' | … . SQLite exposes tables and views (no listable functions).
function listSqliteObjects(db) {
  return db
    .prepare(
      `SELECT name, type FROM sqlite_master
       WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
       ORDER BY type, name`
    )
    .all()
    .map((r) => ({ name: r.name, type: r.type }))
}

function getSqliteTableData(db, table, limit = 200) {
  try {
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all()
    const columnNames = columns.map(c => c.name)
    
    const rows = db.prepare(`SELECT * FROM "${table}" LIMIT ${limit}`).all()
    return { columns: columnNames, rows }
  } catch (error) {
    return { columns: [], rows: [], error: error.message }
  }
}

function getSqliteColumns(db, table) {
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all()
  // Map each FK column to its referenced table/column.
  const fkMap = {}
  for (const fk of db.prepare(`PRAGMA foreign_key_list("${table}")`).all()) {
    fkMap[fk.from] = { table: fk.table, column: fk.to }
  }
  return cols.map((c) => ({
    name: c.name,
    type: c.type || '',
    notnull: !!c.notnull,
    pk: !!c.pk,
    default: c.dflt_value,
    references: fkMap[c.name] || null,
  }))
}

function getSqliteIndexes(db, table) {
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

function runSqliteQuery(db, sql) {
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
    return { type: 'message', message: `Query OK · ${result.changes} row(s) affected.` }
  } catch (error) {
    return { error: error.message }
  }
}

// ============================================================================
// PostgreSQL Utilities
// ============================================================================

// Build a node-postgres client/pool config from a stored connection.
// Handles optional database, "no authentication" mode, and SSL modes.
function pgConfig(config) {
  const noAuth = config.auth === 'none'
  const ssl =
    !config.sslmode || config.sslmode === 'disable'
      ? false
      : { rejectUnauthorized: config.sslmode === 'verify-full' }
  return {
    host: config.host,
    port: parseInt(config.port) || 5432,
    user: noAuth ? undefined : config.username || undefined,
    password: noAuth ? undefined : config.password || undefined,
    database: config.database || undefined,
    ssl,
  }
}

// A pool per (connection, database) so we can browse other databases on the
// same server using the same credentials.
function getPostgresPool(conn, database) {
  const db = database || conn.database
  const key = `${conn.id}::${db || ''}`
  if (!postgresConnections.has(key)) {
    postgresConnections.set(key, new Pool(pgConfig({ ...conn, database: db })))
  }
  return postgresConnections.get(key)
}

function closePostgresPools(id) {
  for (const [key, pool] of postgresConnections) {
    if (key === id || key.startsWith(`${id}::`)) {
      pool.end()
      postgresConnections.delete(key)
    }
  }
}

async function listPostgresTables(pool, schema = 'public') {
  try {
    const res = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
      [schema]
    )
    return res.rows.map((r) => r.tablename)
  } catch (error) {
    return []
  }
}

// Generic object list for Postgres: tables, (materialized) views and functions.
// Each sub-query is isolated so one failing kind never blanks the whole list.
async function listPostgresObjects(pool, schema = 'public') {
  const out = []
  const safe = async (fn) => {
    try {
      await fn()
    } catch (error) {
      console.error('listPostgresObjects:', error.message)
    }
  }
  await safe(async () => {
    const r = await pool.query(`SELECT tablename AS name FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`, [schema])
    for (const row of r.rows) out.push({ name: row.name, type: 'table', schema })
  })
  await safe(async () => {
    const r = await pool.query(`SELECT viewname AS name FROM pg_views WHERE schemaname = $1 ORDER BY viewname`, [schema])
    for (const row of r.rows) out.push({ name: row.name, type: 'view', schema })
  })
  await safe(async () => {
    const r = await pool.query(`SELECT matviewname AS name FROM pg_matviews WHERE schemaname = $1 ORDER BY matviewname`, [schema])
    for (const row of r.rows) out.push({ name: row.name, type: 'view', schema, materialized: true })
  })
  await safe(async () => {
    const r = await pool.query(
      `SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = $1 AND p.prokind = 'f'
       ORDER BY p.proname`,
      [schema]
    )
    for (const row of r.rows) out.push({ name: row.name, type: 'function', schema, detail: row.args || '' })
  })
  return out
}

async function getPostgresTableData(pool, table, limit = 200, schema = 'public') {
  try {
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = $1 AND table_schema = $2 ORDER BY ordinal_position`,
      [table, schema]
    )
    const columnNames = columns.rows.map((r) => r.column_name)
    const rows = await pool.query(`SELECT * FROM "${schema}"."${table}" LIMIT ${limit}`)
    return { columns: columnNames, rows: rows.rows }
  } catch (error) {
    return { columns: [], rows: [], error: error.message }
  }
}

// Reconstruct the column's real Postgres type, including its length/precision
// (e.g. "character varying(255)", "numeric(10,2)") exactly as the database
// reports it — no aliasing to short names.
function pgFullType(c) {
  const t = c.data_type
  if ((t === 'character varying' || t === 'character') && c.character_maximum_length != null) {
    return `${t}(${c.character_maximum_length})`
  }
  if (t === 'numeric' && c.numeric_precision != null) {
    return c.numeric_scale ? `${t}(${c.numeric_precision},${c.numeric_scale})` : `${t}(${c.numeric_precision})`
  }
  return t
}

async function getPostgresColumns(pool, table, schema = 'public') {
  const r = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default,
            character_maximum_length, numeric_precision, numeric_scale
     FROM information_schema.columns
     WHERE table_name = $1 AND table_schema = $2
     ORDER BY ordinal_position`,
    [table, schema]
  )
  // Identify the primary-key columns so row selection / delete / duplicate work.
  const pkRes = await pool.query(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1 AND tc.table_schema = $2`,
    [table, schema]
  )
  const pkSet = new Set(pkRes.rows.map((row) => row.column_name))
  // Map each FK column to its referenced table/column.
  const fkRes = await pool.query(
    `SELECT kcu.column_name AS column, ccu.table_name AS ref_table, ccu.column_name AS ref_column
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1 AND tc.table_schema = $2`,
    [table, schema]
  )
  const fkMap = {}
  for (const row of fkRes.rows) fkMap[row.column] = { table: row.ref_table, column: row.ref_column }
  return r.rows.map((c) => ({
    name: c.column_name,
    type: pgFullType(c),
    notnull: c.is_nullable === 'NO',
    pk: pkSet.has(c.column_name),
    default: c.column_default,
    references: fkMap[c.column_name] || null,
  }))
}

async function getPostgresIndexes(pool, table, schema = 'public') {
  const r = await pool.query(
    `SELECT i.relname AS name, am.amname AS algorithm, ix.indisunique AS unique,
            (SELECT string_agg(a.attname, ', ' ORDER BY k.ord)
             FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum) AS columns,
            pg_get_expr(ix.indpred, ix.indrelid) AS condition,
            obj_description(i.oid) AS comment
     FROM pg_index ix
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN pg_class t ON t.oid = ix.indrelid
     JOIN pg_am am ON am.oid = i.relam
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE t.relname = $1 AND n.nspname = $2
     ORDER BY i.relname`,
    [table, schema]
  )
  return r.rows.map((row) => ({
    name: row.name,
    algorithm: (row.algorithm || '').toUpperCase(),
    unique: row.unique,
    columns: row.columns || '',
    condition: row.condition || '',
    include: '',
    comment: row.comment || '',
  }))
}

// Function definition(s) for a name (a name may have several overloads).
async function getPostgresFunction(pool, name, schema = 'public') {
  const r = await pool.query(
    `SELECT p.proname AS name,
            pg_get_function_identity_arguments(p.oid) AS args,
            pg_get_functiondef(p.oid) AS definition
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = $1 AND p.proname = $2 AND p.prokind = 'f'
     ORDER BY p.proname`,
    [schema, name]
  )
  return r.rows.map((row) => ({ name: row.name, args: row.args || '', definition: row.definition || '' }))
}

async function runPostgresQuery(pool, sql, schema) {
  try {
    let result
    if (schema && schema !== 'public') {
      // Run on a dedicated client with the schema first on the search path.
      const client = await pool.connect()
      try {
        await client.query(`SET search_path TO "${schema}", public`)
        result = await client.query(sql)
      } finally {
        client.release()
      }
    } else {
      result = await pool.query(sql)
    }
    // A populated `fields` list means the command returned a result set —
    // SELECT, EXPLAIN [ANALYZE], SHOW, VALUES, WITH … SELECT, INSERT … RETURNING.
    // Commands like INSERT/UPDATE/DELETE leave it empty, so we report rowCount.
    const columns = result.fields ? result.fields.map((f) => f.name) : []
    if (columns.length) {
      return { type: 'rows', columns, rows: result.rows }
    }
    return { type: 'message', message: `Query OK · ${result.rowCount ?? 0} row(s) affected.` }
  } catch (error) {
    return { error: error.message }
  }
}

// ============================================================================
// API Routes
// ============================================================================

// Authenticate a user
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {}
  const row = meta.prepare('SELECT id, username, name, role, password_hash FROM users WHERE username = ?').get(username)
  if (!row || row.password_hash !== sha256(password)) {
    return res.status(401).json({ error: 'Invalid username or password' })
  }
  res.json({ id: row.id, username: row.username, name: row.name, role: row.role })
})

// Get all connections
app.get('/api/connections', (req, res) => {
  res.json(listConnections())
})

// Test connection
app.post('/api/test-connection', async (req, res) => {
  const { type, filepath } = req.body

  try {
    if (type === 'sqlite') {
      const db = new Database(filepath)
      const tables = listSqliteTables(db)
      db.close()
      res.json({ ok: true, message: `Connected! ${tables.length} table(s) found.` })
    } else if (type === 'postgresql') {
      const client = new Client(pgConfig(req.body))
      await client.connect()
      const { rows } = await client.query('SELECT current_database() AS db')
      await client.end()
      res.json({ ok: true, message: `Connected to PostgreSQL${rows[0]?.db ? ` (${rows[0].db})` : ''}!` })
    }
  } catch (error) {
    res.json({ ok: false, message: error.message })
  }
})

// Add connection
app.post('/api/connections', (req, res) => {
  const conn = { ...req.body, id: randomUUID() }
  saveConnection(conn)
  res.json(conn)
})

// Update connection
app.put('/api/connections/:id', (req, res) => {
  const existing = getConnection(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Connection not found' })
  const updated = { ...existing, ...req.body, id: req.params.id }
  saveConnection(updated)

  // Drop any cached pool/handle so the next query reconnects with the new
  // config (otherwise edits to host/credentials/database are ignored).
  closePostgresPools(req.params.id)
  if (existing.filepath) sqliteConnections.delete(existing.filepath)
  if (updated.filepath && updated.filepath !== existing.filepath) sqliteConnections.delete(updated.filepath)

  res.json(updated)
})

// Delete connection
app.delete('/api/connections/:id', (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  if (conn.type === 'sqlite') {
    sqliteConnections.delete(conn.filepath)
  } else if (conn.type === 'postgresql') {
    closePostgresPools(conn.id)
  }

  deleteConnectionRow(req.params.id)
  meta.prepare('DELETE FROM saved_queries WHERE connection_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM saved_folders WHERE connection_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM query_history WHERE connection_id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ---- Saved queries (per connection) ----
app.get('/api/connections/:id/saved', (req, res) => {
  const rows = meta
    .prepare('SELECT id, name, sql, kind, folder_id, ts FROM saved_queries WHERE connection_id = ? ORDER BY ts DESC')
    .all(req.params.id)
  res.json(rows.map((r) => ({ ...r, kind: r.kind || 'query', folderId: r.folder_id || null })))
})

// ---- Saved folders (per connection) ----
app.get('/api/connections/:id/folders', (req, res) => {
  const rows = meta
    .prepare('SELECT id, name, ts FROM saved_folders WHERE connection_id = ? ORDER BY ts ASC')
    .all(req.params.id)
  res.json(rows)
})

app.post('/api/connections/:id/folders', (req, res) => {
  const { name } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'A folder name is required' })
  const entry = { id: randomUUID(), name: name.trim(), ts: Date.now() }
  meta
    .prepare('INSERT INTO saved_folders (id, connection_id, name, ts) VALUES (?, ?, ?, ?)')
    .run(entry.id, req.params.id, entry.name, entry.ts)
  res.json(entry)
})

app.put('/api/connections/:id/folders/:fid', (req, res) => {
  const { name } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'A folder name is required' })
  const r = meta
    .prepare('UPDATE saved_folders SET name = ? WHERE id = ? AND connection_id = ?')
    .run(name.trim(), req.params.fid, req.params.id)
  if (!r.changes) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true, name: name.trim() })
})

app.delete('/api/connections/:id/folders/:fid', (req, res) => {
  // Detach the folder's queries back to the root, then remove the folder.
  meta
    .prepare('UPDATE saved_queries SET folder_id = NULL WHERE folder_id = ? AND connection_id = ?')
    .run(req.params.fid, req.params.id)
  meta.prepare('DELETE FROM saved_folders WHERE id = ? AND connection_id = ?').run(req.params.fid, req.params.id)
  res.json({ ok: true })
})

app.post('/api/connections/:id/saved', (req, res) => {
  const { name, sql, kind } = req.body || {}
  if (!name?.trim() || !sql?.trim()) return res.status(400).json({ error: 'A name and SQL are required' })
  const entry = { id: randomUUID(), name: name.trim(), sql: sql.trim(), kind: kind || 'query', ts: Date.now() }
  meta
    .prepare('INSERT INTO saved_queries (id, connection_id, name, sql, kind, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .run(entry.id, req.params.id, entry.name, entry.sql, entry.kind, entry.ts)
  res.json(entry)
})

app.put('/api/connections/:id/saved/:sid', (req, res) => {
  const body = req.body || {}
  const { name, sql } = body
  const sets = []
  const vals = []
  if (name != null) {
    if (!name.trim()) return res.status(400).json({ error: 'A name is required' })
    sets.push('name = ?')
    vals.push(name.trim())
  }
  if (sql != null) {
    if (!sql.trim()) return res.status(400).json({ error: 'SQL is required' })
    sets.push('sql = ?')
    vals.push(sql.trim())
  }
  // folderId is explicitly settable (null moves the query back to the root).
  if ('folderId' in body) {
    sets.push('folder_id = ?')
    vals.push(body.folderId || null)
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  const r = meta
    .prepare(`UPDATE saved_queries SET ${sets.join(', ')} WHERE id = ? AND connection_id = ?`)
    .run(...vals, req.params.sid, req.params.id)
  if (!r.changes) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

app.delete('/api/connections/:id/saved/:sid', (req, res) => {
  meta.prepare('DELETE FROM saved_queries WHERE id = ? AND connection_id = ?').run(req.params.sid, req.params.id)
  res.json({ ok: true })
})

// ---- Query history (per connection) ----
app.get('/api/connections/:id/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 500, 5000)
  const rows = meta
    .prepare(
      `SELECT id, table_name, query, status, latency, error, executor_id, executor_name, ts
       FROM query_history WHERE connection_id = ? ORDER BY ts DESC LIMIT ?`
    )
    .all(req.params.id, limit)
  res.json(
    rows.map((r) => ({
      id: r.id,
      table: r.table_name || null,
      query: r.query,
      status: r.status,
      latency: r.latency,
      error: r.error || null,
      executorId: r.executor_id || null,
      executorName: r.executor_name || r.executor_id || null,
      executedAt: r.ts,
    }))
  )
})

app.post('/api/connections/:id/history', (req, res) => {
  const { table, query, status, latency, error, executorId, executorName } = req.body || {}
  if (!query?.trim()) return res.status(400).json({ error: 'A query is required' })
  const entry = {
    id: randomUUID(),
    table: table?.trim() || null,
    query: query.trim(),
    status: status === 'failed' ? 'failed' : 'success',
    latency: Number.isFinite(latency) ? Math.round(latency) : null,
    error: error || null,
    executorId: executorId || null,
    executorName: executorName || null,
    executedAt: Date.now(),
  }
  meta
    .prepare(
      `INSERT INTO query_history
       (id, connection_id, table_name, query, status, latency, error, executor_id, executor_name, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.id,
      req.params.id,
      entry.table,
      entry.query,
      entry.status,
      entry.latency,
      entry.error,
      entry.executorId,
      entry.executorName,
      entry.executedAt
    )
  res.json(entry)
})

app.delete('/api/connections/:id/history', (req, res) => {
  // With { ids: [...] } delete just those entries; otherwise clear everything.
  const ids = req.body?.ids
  if (Array.isArray(ids) && ids.length) {
    const del = meta.prepare('DELETE FROM query_history WHERE id = ? AND connection_id = ?')
    const tx = meta.transaction((list) => list.forEach((hid) => del.run(hid, req.params.id)))
    tx(ids)
  } else {
    meta.prepare('DELETE FROM query_history WHERE connection_id = ?').run(req.params.id)
  }
  res.json({ ok: true })
})

// Get tables for a connection
app.get('/api/connections/:id/tables', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  try {
    let tables = []
    if (conn.type === 'sqlite') {
      const db = getSqliteDb(conn.filepath)
      tables = listSqliteTables(db)
    } else if (conn.type === 'postgresql') {
      const pool = getPostgresPool(conn, req.query.database)
      tables = await listPostgresTables(pool, req.query.schema || 'public')
    }
    res.json(tables)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Connectivity check — attempts to reach the database and reports { ok }.
// Generic across engines so the client can detect a dropped connection.
app.get('/api/connections/:id/ping', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ ok: false, error: 'Connection not found' })

  try {
    if (conn.type === 'sqlite') {
      getSqliteDb(conn.filepath).prepare('SELECT 1').get()
    } else if (conn.type === 'postgresql') {
      await getPostgresPool(conn, req.query.database).query('SELECT 1')
    }
    res.json({ ok: true })
  } catch (error) {
    res.json({ ok: false, error: error.message })
  }
})

// List all browsable database objects (tables, views, functions, …) as a
// generic [{ name, type, ... }] list so any dialect can populate the browser.
app.get('/api/connections/:id/objects', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  try {
    let objects = []
    if (conn.type === 'sqlite') {
      objects = listSqliteObjects(getSqliteDb(conn.filepath))
    } else if (conn.type === 'postgresql') {
      objects = await listPostgresObjects(getPostgresPool(conn, req.query.database), req.query.schema || 'public')
    }
    res.json(objects)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Function definition(s) for a named routine (empty for engines without them).
app.get('/api/connections/:id/function/:name', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  try {
    let functions = []
    if (conn.type === 'postgresql') {
      functions = await getPostgresFunction(getPostgresPool(conn, req.query.database), req.params.name, req.query.schema || 'public')
    }
    res.json(functions)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get table data
app.get('/api/connections/:id/table/:table', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  try {
    let result
    if (conn.type === 'sqlite') {
      const db = getSqliteDb(conn.filepath)
      result = getSqliteTableData(db, req.params.table, parseInt(req.query.limit) || 200)
    } else if (conn.type === 'postgresql') {
      const pool = getPostgresPool(conn, req.query.database)
      result = await getPostgresTableData(pool, req.params.table, parseInt(req.query.limit) || 200, req.query.schema || 'public')
    }
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get column schema for a table
app.get('/api/connections/:id/columns/:table', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  try {
    let columns = []
    if (conn.type === 'sqlite') {
      columns = getSqliteColumns(getSqliteDb(conn.filepath), req.params.table)
    } else if (conn.type === 'postgresql') {
      columns = await getPostgresColumns(getPostgresPool(conn, req.query.database), req.params.table, req.query.schema || 'public')
    }
    res.json(columns)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// List a table's indexes.
app.get('/api/connections/:id/indexes/:table', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  try {
    let indexes = []
    if (conn.type === 'sqlite') {
      indexes = getSqliteIndexes(getSqliteDb(conn.filepath), req.params.table)
    } else if (conn.type === 'postgresql') {
      indexes = await getPostgresIndexes(getPostgresPool(conn, req.query.database), req.params.table, req.query.schema || 'public')
    }
    res.json(indexes)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Full schema (table -> column names) for editor autocomplete
app.get('/api/connections/:id/schema', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  try {
    const schema = {}
    if (conn.type === 'sqlite') {
      const db = getSqliteDb(conn.filepath)
      for (const t of listSqliteTables(db)) {
        schema[t] = getSqliteColumns(db, t).map((c) => c.name)
      }
    } else if (conn.type === 'postgresql') {
      const pool = getPostgresPool(conn, req.query.database)
      const r = await pool.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = $1 ORDER BY table_name, ordinal_position`,
        [req.query.schema || 'public']
      )
      for (const row of r.rows) {
        ;(schema[row.table_name] ||= []).push(row.column_name)
      }
    }
    res.json(schema)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// List databases + schemas available on a connection (for the breadcrumb).
app.get('/api/connections/:id/namespaces', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  try {
    if (conn.type === 'sqlite') {
      const name = path.basename(conn.filepath || 'database')
      return res.json({ databases: [name], schemas: ['main'], currentDatabase: name })
    }
    const database = req.query.database || conn.database || undefined
    const pool = getPostgresPool(conn, database)
    const dbs = await pool.query(
      `SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn ORDER BY datname`
    )
    const schemas = await pool.query(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name NOT LIKE 'pg\\_%' AND schema_name <> 'information_schema'
       ORDER BY schema_name`
    )
    const cur = await pool.query('SELECT current_database() AS db')
    res.json({
      databases: dbs.rows.map((r) => r.datname),
      schemas: schemas.rows.map((r) => r.schema_name),
      currentDatabase: cur.rows[0]?.db,
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Column data types the schema editor offers, per dialect. Postgres uses the
// database's own type vocabulary (matching what /columns reports) so the same
// list is consistent for both existing and new columns.
const DATA_TYPES = {
  sqlite: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'],
  postgresql: [
    'serial', 'bigserial', 'smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision',
    'boolean', 'text', 'character varying', 'character', 'date', 'time without time zone',
    'timestamp without time zone', 'timestamp with time zone', 'json', 'jsonb', 'uuid',
  ],
}

// Available column types for a connection's dialect.
app.get('/api/connections/:id/types', (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  res.json({ types: DATA_TYPES[conn.type === 'postgresql' ? 'postgresql' : 'sqlite'] })
})

// Schema diagram: every table's columns + foreign-key relationships.
app.get('/api/connections/:id/diagram', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  try {
    const tables = []
    const foreignKeys = []

    if (conn.type === 'sqlite') {
      const db = getSqliteDb(conn.filepath)
      for (const t of listSqliteTables(db)) {
        tables.push({ name: t, columns: getSqliteColumns(db, t) })
        for (const fk of db.prepare(`PRAGMA foreign_key_list("${t}")`).all()) {
          foreignKeys.push({ table: t, column: fk.from, refTable: fk.table, refColumn: fk.to, onDelete: fk.on_delete, onUpdate: fk.on_update })
        }
      }
    } else if (conn.type === 'postgresql') {
      const schema = req.query.schema || 'public'
      const pool = getPostgresPool(conn, req.query.database)
      for (const t of await listPostgresTables(pool, schema)) {
        tables.push({ name: t, columns: await getPostgresColumns(pool, t, schema) })
      }
      const fkRes = await pool.query(
        `SELECT tc.constraint_name AS constraint, tc.table_name AS table, kcu.column_name AS column,
               ccu.table_name AS ref_table, ccu.column_name AS ref_column,
               rc.delete_rule AS on_delete, rc.update_rule AS on_update
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1`,
        [schema]
      )
      for (const r of fkRes.rows) {
        foreignKeys.push({ constraint: r.constraint, table: r.table, column: r.column, refTable: r.ref_table, refColumn: r.ref_column, onDelete: r.on_delete, onUpdate: r.on_update })
      }
    }
    res.json({ tables, foreignKeys })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Insert a row (parameterized)
app.post('/api/connections/:id/insert', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  const { table, values, database, schema } = req.body
  const cols = Object.keys(values || {})
  if (!table || cols.length === 0) {
    return res.status(400).json({ error: 'A table and at least one value are required' })
  }

  try {
    const colList = cols.map((c) => `"${c}"`).join(', ')
    if (conn.type === 'sqlite') {
      const db = getSqliteDb(conn.filepath)
      const sql = `INSERT INTO "${table}" (${colList}) VALUES (${cols.map(() => '?').join(', ')})`
      // better-sqlite3 can only bind numbers/strings/bigints/buffers/null.
      const params = cols.map((c) => {
        const v = values[c]
        if (typeof v === 'boolean') return v ? 1 : 0
        return v === undefined ? null : v
      })
      const info = db.prepare(sql).run(...params)
      res.json({ ok: true, changes: info.changes, lastInsertRowid: info.lastInsertRowid })
    } else if (conn.type === 'postgresql') {
      const pool = getPostgresPool(conn, database)
      const sql = `INSERT INTO "${schema || 'public'}"."${table}" (${colList}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`
      const result = await pool.query(sql, cols.map((c) => values[c]))
      res.json({ ok: true, changes: result.rowCount })
    }
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// Execute query
app.post('/api/connections/:id/query', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  const { sql, database, schema } = req.body
  if (!sql || !sql.trim()) {
    return res.status(400).json({ error: 'SQL query required' })
  }

  try {
    let result
    if (conn.type === 'sqlite') {
      const db = getSqliteDb(conn.filepath)
      result = runSqliteQuery(db, sql)
    } else if (conn.type === 'postgresql') {
      const pool = getPostgresPool(conn, database)
      result = await runPostgresQuery(pool, sql, schema)
    }
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

// Serve the built frontend (production) with SPA fallback for client routes.
const DIST = path.join(__dirname, 'dist')
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST))
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')))
}

// 404 (API + anything else when no frontend build is present)
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// Error handler
app.use((error, req, res, next) => {
  console.error(error)
  res.status(500).json({ error: error.message })
})

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`)
  console.log(`📊 API available at http://localhost:${PORT}/api`)
  // Pre-open existing SQLite connections so the first query is fast.
  for (const conn of listConnections()) {
    if (conn.type === 'sqlite' && conn.filepath) {
      try {
        getSqliteDb(conn.filepath)
      } catch (error) {
        console.error(`Failed to open ${conn.filepath}:`, error.message)
      }
    }
  }
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...')
  for (const [, db] of sqliteConnections) db.close()
  for (const [, pool] of postgresConnections) pool.end()
  meta.close()
  process.exit(0)
})
