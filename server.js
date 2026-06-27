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
import { POSTGRES_SEED } from './src/db/seed-data.js'
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
      ts INTEGER
    );
  `)

  // Seed the default admin user.
  if (!meta.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    meta
      .prepare('INSERT INTO users (id, username, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), 'admin', sha256('admin123'), 'Admin', 'admin')
    console.log('🌱 Seeded default user: admin / admin123')
  }

  // Seed the demo connection so its id resolves for table/query routes.
  if (!meta.prepare('SELECT 1 FROM connections WHERE id = ?').get('demo-sqlite')) {
    const demo = {
      id: 'demo-sqlite',
      name: 'Demo Database',
      type: 'sqlite',
      environment: 'local',
      filepath: './demo.db',
      folder: 'Demo',
    }
    meta.prepare('INSERT INTO connections (id, data, created_at) VALUES (?, ?, ?)').run(demo.id, JSON.stringify(demo), Date.now())
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
    const db = new Database(path)
    // Auto-seed the demo database the first time it's opened empty so a fresh
    // (deleted/recreated) demo.db always comes back with sample data.
    if (path.endsWith('demo.db')) seedDemoIfEmpty(db)
    sqliteConnections.set(path, db)
  }
  return sqliteConnections.get(path)
}

function seedDemoIfEmpty(db) {
  const { n } = db
    .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .get()
  if (n > 0) return false

  console.log('🌱 demo.db is empty — seeding sample data...')
  const statements = POSTGRES_SEED.split(';').map((s) => s.trim()).filter(Boolean)
  const seed = db.transaction(() => {
    for (const stmt of statements) {
      try {
        db.exec(stmt)
      } catch (error) {
        console.error('   seed statement failed:', error.message)
      }
    }
  })
  seed()
  const tables = listSqliteTables(db)
  console.log(`✅ Seeded ${tables.length} table(s): ${tables.join(', ')}`)
  return true
}

function listSqliteTables(db) {
  const res = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%' 
    ORDER BY name
  `).all()
  return res.map(r => r.name)
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
  return cols.map((c) => ({
    name: c.name,
    type: c.type || '',
    notnull: !!c.notnull,
    pk: !!c.pk,
    default: c.dflt_value,
  }))
}

function runSqliteQuery(db, sql) {
  try {
    const stmt = db.prepare(sql)
    const isSelect = sql.trim().toUpperCase().startsWith('SELECT')
    
    if (isSelect) {
      const rows = stmt.all()
      const columns = rows.length ? Object.keys(rows[0]) : []
      return { type: 'rows', columns, rows }
    } else {
      const result = stmt.run()
      return { type: 'message', message: `Query OK · ${result.changes} row(s) affected.` }
    }
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

async function getPostgresPool(id, config) {
  if (!postgresConnections.has(id)) {
    postgresConnections.set(id, new Pool(pgConfig(config)))
  }
  return postgresConnections.get(id)
}

async function listPostgresTables(pool) {
  try {
    const res = await pool.query(`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `)
    return res.rows.map(r => r.tablename)
  } catch (error) {
    return []
  }
}

async function getPostgresTableData(pool, table, limit = 200) {
  try {
    const columns = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = $1 AND table_schema = 'public'
      ORDER BY ordinal_position
    `, [table])
    const columnNames = columns.rows.map(r => r.column_name)
    
    const rows = await pool.query(`SELECT * FROM "${table}" LIMIT ${limit}`)
    return { columns: columnNames, rows: rows.rows }
  } catch (error) {
    return { columns: [], rows: [], error: error.message }
  }
}

async function getPostgresColumns(pool, table) {
  const r = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_name = $1 AND table_schema = 'public'
     ORDER BY ordinal_position`,
    [table]
  )
  return r.rows.map((c) => ({
    name: c.column_name,
    type: c.data_type,
    notnull: c.is_nullable === 'NO',
    pk: false,
    default: c.column_default,
  }))
}

async function runPostgresQuery(pool, sql) {
  try {
    const result = await pool.query(sql)
    const isSelect = sql.trim().toUpperCase().startsWith('SELECT')
    
    if (isSelect) {
      const columns = result.fields ? result.fields.map(f => f.name) : []
      return { type: 'rows', columns, rows: result.rows }
    } else {
      return { type: 'message', message: `Query OK · ${result.rowCount} row(s) affected.` }
    }
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
  res.json(updated)
})

// Delete connection
app.delete('/api/connections/:id', (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  if (conn.type === 'sqlite') {
    sqliteConnections.delete(conn.filepath)
  } else if (conn.type === 'postgresql') {
    const pool = postgresConnections.get(conn.id)
    if (pool) pool.end()
    postgresConnections.delete(conn.id)
  }

  deleteConnectionRow(req.params.id)
  meta.prepare('DELETE FROM saved_queries WHERE connection_id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ---- Saved queries (per connection) ----
app.get('/api/connections/:id/saved', (req, res) => {
  const rows = meta
    .prepare('SELECT id, name, sql, ts FROM saved_queries WHERE connection_id = ? ORDER BY ts DESC')
    .all(req.params.id)
  res.json(rows)
})

app.post('/api/connections/:id/saved', (req, res) => {
  const { name, sql } = req.body || {}
  if (!name?.trim() || !sql?.trim()) return res.status(400).json({ error: 'A name and SQL are required' })
  const entry = { id: randomUUID(), name: name.trim(), sql: sql.trim(), ts: Date.now() }
  meta
    .prepare('INSERT INTO saved_queries (id, connection_id, name, sql, ts) VALUES (?, ?, ?, ?, ?)')
    .run(entry.id, req.params.id, entry.name, entry.sql, entry.ts)
  res.json(entry)
})

app.delete('/api/connections/:id/saved/:sid', (req, res) => {
  meta.prepare('DELETE FROM saved_queries WHERE id = ? AND connection_id = ?').run(req.params.sid, req.params.id)
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
      const pool = await getPostgresPool(conn.id, conn)
      tables = await listPostgresTables(pool)
    }
    res.json(tables)
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
      const pool = await getPostgresPool(conn.id, conn)
      result = await getPostgresTableData(pool, req.params.table, parseInt(req.query.limit) || 200)
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
      columns = await getPostgresColumns(await getPostgresPool(conn.id, conn), req.params.table)
    }
    res.json(columns)
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
      const pool = await getPostgresPool(conn.id, conn)
      const r = await pool.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`
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

// Insert a row (parameterized)
app.post('/api/connections/:id/insert', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  const { table, values } = req.body
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
      const pool = await getPostgresPool(conn.id, conn)
      const sql = `INSERT INTO "${table}" (${colList}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`
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

  const { sql } = req.body
  if (!sql || !sql.trim()) {
    return res.status(400).json({ error: 'SQL query required' })
  }

  try {
    let result
    if (conn.type === 'sqlite') {
      const db = getSqliteDb(conn.filepath)
      result = runSqliteQuery(db, sql)
    } else if (conn.type === 'postgresql') {
      const pool = await getPostgresPool(conn.id, conn)
      result = await runPostgresQuery(pool, sql)
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
  // Open (and seed if empty) any seeded SQLite connections up front.
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
