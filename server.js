#!/usr/bin/env node
/**
 * Backend server for database management
 * Handles SQLite and PostgreSQL connections
 */

import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
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

// Connection pools
const sqliteConnections = new Map()
const postgresConnections = new Map()
const connectionConfigs = new Map() // Store connection metadata

// Seed with the same demo connection the frontend falls back to
// (mirrors INITIAL_CONNECTIONS in src/context/ConnectionsContext.jsx) so its
// id resolves on the server for table/query/create-table routes.
let connectionsList = [
  {
    id: 'demo-sqlite',
    name: 'Demo Database',
    type: 'sqlite',
    environment: 'local',
    filepath: './demo.db',
    folder: 'Demo',
  },
]

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

async function getPostgresPool(id, config) {
  if (!postgresConnections.has(id)) {
    const pool = new Pool({
      host: config.host,
      port: parseInt(config.port),
      user: config.username,
      password: config.password,
      database: config.database,
    })
    postgresConnections.set(id, pool)
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

// Get all connections
app.get('/api/connections', (req, res) => {
  res.json(connectionsList)
})

// Test connection
app.post('/api/test-connection', async (req, res) => {
  const { type, host, port, username, password, database, filepath } = req.body

  try {
    if (type === 'sqlite') {
      const db = new Database(filepath)
      const tables = listSqliteTables(db)
      db.close()
      res.json({ ok: true, message: `Connected! ${tables.length} table(s) found.` })
    } else if (type === 'postgresql') {
      const client = new Client({
        host,
        port: parseInt(port),
        user: username,
        password,
        database,
      })
      await client.connect()
      const result = await client.query("SELECT version()")
      await client.end()
      res.json({ ok: true, message: 'Connected to PostgreSQL successfully!' })
    }
  } catch (error) {
    res.json({ ok: false, message: error.message })
  }
})

// Add connection
app.post('/api/connections', (req, res) => {
  const conn = { ...req.body, id: randomUUID() }
  connectionsList.push(conn)
  res.json(conn)
})

// Update connection
app.put('/api/connections/:id', (req, res) => {
  const idx = connectionsList.findIndex(c => c.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Connection not found' })
  connectionsList[idx] = { ...connectionsList[idx], ...req.body }
  res.json(connectionsList[idx])
})

// Delete connection
app.delete('/api/connections/:id', (req, res) => {
  const idx = connectionsList.findIndex(c => c.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Connection not found' })
  
  const conn = connectionsList[idx]
  if (conn.type === 'sqlite') {
    sqliteConnections.delete(conn.filepath)
  } else if (conn.type === 'postgresql') {
    const pool = postgresConnections.get(conn.id)
    if (pool) pool.end()
    postgresConnections.delete(conn.id)
  }
  
  connectionsList.splice(idx, 1)
  res.json({ ok: true })
})

// Get tables for a connection
app.get('/api/connections/:id/tables', async (req, res) => {
  const conn = connectionsList.find(c => c.id === req.params.id)
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
  const conn = connectionsList.find(c => c.id === req.params.id)
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

// Execute query
app.post('/api/connections/:id/query', async (req, res) => {
  const conn = connectionsList.find(c => c.id === req.params.id)
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

// 404
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
  for (const conn of connectionsList) {
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
  for (const [, db] of sqliteConnections) {
    db.close()
  }
  for (const [, pool] of postgresConnections) {
    pool.end()
  }
  process.exit(0)
})
