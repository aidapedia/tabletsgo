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
import nodemailer from 'nodemailer'
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
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      settings TEXT,               -- JSON: { smtp: {...} }
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,          -- 'admin' | 'member'
      created_at INTEGER,
      UNIQUE(workspace_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER
    );
  `)
  // Migrate older DBs that predate these columns.
  const addColumn = (table, col) => {
    const name = col.split(' ')[0]
    try {
      meta.prepare(`SELECT ${name} FROM ${table} LIMIT 1`).get()
    } catch {
      meta.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`)
    }
  }
  addColumn('saved_queries', 'kind TEXT')
  addColumn('saved_queries', 'folder_id TEXT')
  // Invited members: username holds the email, password blank until accepted.
  addColumn('users', "status TEXT")           // 'active' | 'pending'
  addColumn('users', 'invite_token TEXT')
  addColumn('users', 'invite_workspace TEXT')
  addColumn('users', 'token_expires INTEGER')
  // Password reset (separate from invite tokens so the two never collide).
  addColumn('users', 'reset_token TEXT')
  addColumn('users', 'reset_expires INTEGER')
  meta.exec(`UPDATE users SET status = 'active' WHERE status IS NULL`)

  const hasUsers = !!meta.prepare('SELECT 1 FROM users LIMIT 1').get()

  // Optional pre-seed from env — skips the first-run setup wizard.
  if (!hasUsers && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
    const uid = randomUUID()
    const wid = randomUUID()
    const now = Date.now()
    meta
      .prepare('INSERT INTO users (id, username, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uid, process.env.ADMIN_USERNAME, sha256(process.env.ADMIN_PASSWORD), 'Admin', 'admin', 'active')
    meta
      .prepare('INSERT INTO workspaces (id, name, settings, created_at) VALUES (?, ?, ?, ?)')
      .run(wid, process.env.WORKSPACE_NAME || 'My Workspace', '{}', now)
    meta
      .prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), wid, uid, 'admin', now)
    console.log(`🌱 Seeded admin ${process.env.ADMIN_USERNAME} + workspace`)
  }

  // Migrate pre-workspace installs: create a Default workspace, enroll existing
  // users, and attach existing connections to it.
  if (hasUsers && !meta.prepare('SELECT 1 FROM workspaces LIMIT 1').get()) {
    const wid = randomUUID()
    const now = Date.now()
    meta.prepare('INSERT INTO workspaces (id, name, settings, created_at) VALUES (?, ?, ?, ?)').run(wid, 'Default Workspace', '{}', now)
    meta
      .prepare('SELECT id, role FROM users')
      .all()
      .forEach((u, i) => {
        meta
          .prepare('INSERT OR IGNORE INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(randomUUID(), wid, u.id, u.role === 'admin' || i === 0 ? 'admin' : 'member', now)
      })
    for (const row of meta.prepare('SELECT id, data FROM connections').all()) {
      const data = JSON.parse(row.data)
      if (!data.workspaceId) {
        data.workspaceId = wid
        meta.prepare('UPDATE connections SET data = ? WHERE id = ?').run(JSON.stringify(data), row.id)
      }
    }
    console.log('🔁 Migrated existing users/connections into Default Workspace')
  }
}
initMetaDb()

// ---- Auth / session helpers ----
const createSession = (userId) => {
  const token = randomUUID()
  meta.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, Date.now())
  return token
}
const userFromToken = (token) => {
  if (!token) return null
  const s = meta.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token)
  if (!s) return null
  return meta.prepare("SELECT id, username, name, role, status FROM users WHERE id = ?").get(s.user_id) || null
}
// Resolve the caller from the Bearer token (null if unauthenticated).
const authUser = (req) => {
  const h = req.headers.authorization || ''
  return userFromToken(h.startsWith('Bearer ') ? h.slice(7) : null)
}
// Public shape returned to the client (never the password hash).
const publicUser = (u) => (u ? { id: u.id, email: u.username, name: u.name, role: u.role } : null)

// Require an authenticated caller; sends 401 and returns null otherwise.
const requireAuth = (req, res) => {
  const user = authUser(req)
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
  return user
}

// ---- Workspace helpers ----
const memberRole = (workspaceId, userId) => {
  const m = meta.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, userId)
  return m ? m.role : null
}
const workspaceForUser = (id, userId) => {
  const role = memberRole(id, userId)
  if (!role) return null
  const w = meta.prepare('SELECT id, name, created_at FROM workspaces WHERE id = ?').get(id)
  return w ? { id: w.id, name: w.name, role, createdAt: w.created_at } : null
}
const getUserByEmail = (email) =>
  meta.prepare('SELECT id, username, name, role, status FROM users WHERE username = ?').get(email)
// Absolute base URL of the frontend, for building invite links.
const baseUrl = (req) => req.headers.origin || `${req.protocol}://${req.get('host')}`

// ---- SMTP / email ----
// Resolve SMTP config from the workspace settings, falling back to Docker env.
// Returns null when no host is configured anywhere (invites still return a link).
const smtpConfig = (wsRow) => {
  let ws = {}
  try {
    ws = JSON.parse(wsRow?.settings || '{}').smtp || {}
  } catch {
    ws = {}
  }
  const host = ws.host || process.env.SMTP_HOST
  if (!host) return null
  const user = ws.user || process.env.SMTP_USER || ''
  return {
    host,
    port: Number(ws.port || process.env.SMTP_PORT || 587),
    secure: ws.secure ?? process.env.SMTP_SECURE === 'true',
    user,
    pass: ws.pass || process.env.SMTP_PASS || '',
    from: ws.from || process.env.SMTP_FROM || user || 'no-reply@tabletsgo.local',
  }
}
const sendInviteEmail = async (cfg, { to, workspaceName, link }) => {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  })
  await transport.sendMail({
    from: cfg.from,
    to,
    subject: `You've been invited to ${workspaceName} on Tabletsgo`,
    text: `You've been invited to join ${workspaceName} on Tabletsgo. Set your password: ${link}`,
    html: `<p>You've been invited to join <b>${workspaceName}</b> on Tabletsgo.</p><p><a href="${link}">Accept your invite &amp; set a password</a></p><p style="color:#888">Or paste this link into your browser: ${link}</p>`,
  })
}

// Generic send. `cfg` from smtpConfig(); `message` is { to, subject, text, html }.
const sendMail = async (cfg, message) => {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  })
  await transport.sendMail({ from: cfg.from, ...message })
}

// SMTP usable for an app-level email to a user (password reset): env first,
// then any of the user's workspaces that has SMTP configured.
const smtpForUser = (userId) => {
  const envCfg = smtpConfig(null)
  if (envCfg) return envCfg
  const rows = meta
    .prepare('SELECT w.settings FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE m.user_id = ?')
    .all(userId)
  for (const r of rows) {
    const cfg = smtpConfig(r)
    if (cfg) return cfg
  }
  return null
}
const sendResetEmail = (cfg, { to, link }) =>
  sendMail(cfg, {
    to,
    subject: 'Reset your Tabletsgo password',
    text: `Reset your Tabletsgo password: ${link}\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
    html: `<p>We received a request to reset your Tabletsgo password.</p><p><a href="${link}">Reset your password</a></p><p style="color:#888">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>`,
  })

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

// Authenticate a user (by email, stored in `username`). Returns a session token.
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {}
  const row = meta.prepare('SELECT id, username, name, role, status, password_hash FROM users WHERE username = ?').get(username)
  if (!row || row.status === 'pending' || row.password_hash !== sha256(password)) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }
  res.json({ user: publicUser(row), token: createSession(row.id) })
})

// Log out — invalidate the current session token.
app.post('/api/auth/logout', (req, res) => {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  if (token) meta.prepare('DELETE FROM sessions WHERE token = ?').run(token)
  res.json({ ok: true })
})

// Request a password reset. Always 200 — never reveal whether the email exists.
// When SMTP is available the reset link is emailed; the link is never returned.
app.post('/api/auth/forgot', async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase()
  const user = email ? meta.prepare('SELECT id, username, status FROM users WHERE username = ?').get(email) : null
  if (user && user.status !== 'pending') {
    const token = randomUUID()
    const expires = Date.now() + 60 * 60 * 1000 // 1 hour
    meta.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(token, expires, user.id)
    const cfg = smtpForUser(user.id)
    if (cfg) {
      try {
        await sendResetEmail(cfg, { to: email, link: `${baseUrl(req)}/reset/${token}` })
      } catch (e) {
        console.error('Password reset email failed:', e.message)
      }
    } else {
      console.warn('Password reset requested but no SMTP is configured; cannot email the link.')
    }
  }
  res.json({ ok: true })
})

// Validate a reset token (for the reset page).
app.get('/api/auth/reset/:token', (req, res) => {
  const u = meta.prepare('SELECT username, reset_expires FROM users WHERE reset_token = ?').get(req.params.token)
  if (!u || (u.reset_expires && u.reset_expires < Date.now())) {
    return res.status(404).json({ error: 'This reset link is invalid or has expired.' })
  }
  res.json({ email: u.username })
})

// Set a new password, invalidate existing sessions, and log the user in.
app.post('/api/auth/reset/:token', (req, res) => {
  const u = meta.prepare('SELECT id, reset_expires FROM users WHERE reset_token = ?').get(req.params.token)
  if (!u || (u.reset_expires && u.reset_expires < Date.now())) {
    return res.status(404).json({ error: 'This reset link is invalid or has expired.' })
  }
  const { password } = req.body || {}
  if (!password) return res.status(400).json({ error: 'A password is required.' })
  meta
    .prepare("UPDATE users SET password_hash = ?, status = 'active', reset_token = NULL, reset_expires = NULL WHERE id = ?")
    .run(sha256(password), u.id)
  meta.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id) // sign out other sessions
  const user = meta.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(u.id)
  res.json({ user: publicUser(user), token: createSession(u.id) })
})

// First-run status — true when no users exist yet (setup wizard needed).
app.get('/api/setup', (req, res) => {
  res.json({ needsSetup: !meta.prepare('SELECT 1 FROM users LIMIT 1').get() })
})

// First-run setup — creates the admin account + first workspace. Only allowed
// while no users exist, so it can't be used to hijack an initialized instance.
app.post('/api/setup', (req, res) => {
  if (meta.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    return res.status(403).json({ error: 'Setup has already been completed.' })
  }
  const { email, password, name, workspace } = req.body || {}
  if (!email || !password || !workspace?.trim()) {
    return res.status(400).json({ error: 'Email, password and workspace name are required.' })
  }
  const uid = randomUUID()
  const wid = randomUUID()
  const now = Date.now()
  meta
    .prepare('INSERT INTO users (id, username, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uid, email.trim(), sha256(password), name?.trim() || 'Admin', 'admin', 'active')
  meta.prepare('INSERT INTO workspaces (id, name, settings, created_at) VALUES (?, ?, ?, ?)').run(wid, workspace.trim(), '{}', now)
  meta
    .prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), wid, uid, 'admin', now)
  const user = meta.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(uid)
  res.json({ user: publicUser(user), token: createSession(uid) })
})

// Validate an invite token → who it's for and which workspace.
app.get('/api/invite/:token', (req, res) => {
  const u = meta
    .prepare('SELECT username, invite_workspace, token_expires FROM users WHERE invite_token = ?')
    .get(req.params.token)
  if (!u || (u.token_expires && u.token_expires < Date.now())) {
    return res.status(404).json({ error: 'This invite is invalid or has expired.' })
  }
  const ws = meta.prepare('SELECT name FROM workspaces WHERE id = ?').get(u.invite_workspace)
  res.json({ email: u.username, workspaceName: ws?.name || 'a workspace' })
})

// Accept an invite — set name + password, activate the account, log in.
app.post('/api/invite/:token/accept', (req, res) => {
  const u = meta
    .prepare('SELECT id, username, name, token_expires FROM users WHERE invite_token = ?')
    .get(req.params.token)
  if (!u || (u.token_expires && u.token_expires < Date.now())) {
    return res.status(404).json({ error: 'This invite is invalid or has expired.' })
  }
  const { name, password } = req.body || {}
  if (!password) return res.status(400).json({ error: 'A password is required.' })
  meta
    .prepare("UPDATE users SET password_hash = ?, name = ?, status = 'active', invite_token = NULL, invite_workspace = NULL, token_expires = NULL WHERE id = ?")
    .run(sha256(password), name?.trim() || u.name || u.username, u.id)
  const user = meta.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(u.id)
  res.json({ user: publicUser(user), token: createSession(u.id) })
})

// ============================================================================
// Workspaces
// ============================================================================

// Workspaces the caller belongs to.
app.get('/api/workspaces', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const rows = meta
    .prepare(
      `SELECT w.id, w.name, w.created_at, m.role
       FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = ? ORDER BY w.created_at`
    )
    .all(user.id)
  res.json(rows.map((r) => ({ id: r.id, name: r.name, role: r.role, createdAt: r.created_at })))
})

// Create a workspace — caller becomes its admin.
app.post('/api/workspaces', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const { name } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'Workspace name is required.' })
  const wid = randomUUID()
  const now = Date.now()
  meta.prepare('INSERT INTO workspaces (id, name, settings, created_at) VALUES (?, ?, ?, ?)').run(wid, name.trim(), '{}', now)
  meta
    .prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), wid, user.id, 'admin', now)
  res.json({ id: wid, name: name.trim(), role: 'admin', createdAt: now })
})

app.get('/api/workspaces/:id', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const ws = workspaceForUser(req.params.id, user.id)
  if (!ws) return res.status(404).json({ error: 'Workspace not found' })
  // Admins also get the (password-masked) SMTP config for the settings form.
  if (ws.role === 'admin') {
    const row = meta.prepare('SELECT settings FROM workspaces WHERE id = ?').get(req.params.id)
    let smtp = {}
    try {
      smtp = JSON.parse(row?.settings || '{}').smtp || {}
    } catch {
      smtp = {}
    }
    ws.smtp = { host: smtp.host || '', port: smtp.port || '', secure: !!smtp.secure, user: smtp.user || '', from: smtp.from || '', hasPassword: !!smtp.pass }
    ws.smtpEnvFallback = !!process.env.SMTP_HOST
  }
  res.json(ws)
})

// Rename + SMTP settings (admin).
app.put('/api/workspaces/:id', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const row = meta.prepare('SELECT settings FROM workspaces WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Workspace not found' })
  const { name, smtp } = req.body || {}
  if (name?.trim()) meta.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name.trim(), req.params.id)
  if (smtp) {
    const settings = (() => {
      try {
        return JSON.parse(row.settings || '{}')
      } catch {
        return {}
      }
    })()
    const prev = settings.smtp || {}
    settings.smtp = {
      host: smtp.host ?? prev.host,
      port: smtp.port ?? prev.port,
      secure: smtp.secure ?? prev.secure,
      user: smtp.user ?? prev.user,
      from: smtp.from ?? prev.from,
      // Keep the stored password unless a new one is supplied (never wiped by a save).
      pass: smtp.pass ? smtp.pass : prev.pass,
    }
    meta.prepare('UPDATE workspaces SET settings = ? WHERE id = ?').run(JSON.stringify(settings), req.params.id)
  }
  res.json({ ok: true })
})

// Delete a workspace and everything scoped to it (admin). Never the caller's last one.
app.delete('/api/workspaces/:id', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const mine = meta.prepare('SELECT COUNT(*) c FROM workspace_members WHERE user_id = ?').get(user.id).c
  if (mine <= 1) return res.status(400).json({ error: 'You must belong to at least one workspace.' })
  for (const row of meta.prepare('SELECT id, data FROM connections').all()) {
    if (JSON.parse(row.data).workspaceId === req.params.id) {
      deleteConnectionRow(row.id)
      meta.prepare('DELETE FROM saved_queries WHERE connection_id = ?').run(row.id)
      meta.prepare('DELETE FROM saved_folders WHERE connection_id = ?').run(row.id)
      meta.prepare('DELETE FROM query_history WHERE connection_id = ?').run(row.id)
    }
  }
  meta.prepare('DELETE FROM workspace_members WHERE workspace_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM workspaces WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ---- Members ----

// List a workspace's members (any member can view).
app.get('/api/workspaces/:id/members', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (!memberRole(req.params.id, user.id)) return res.status(403).json({ error: 'Forbidden' })
  const rows = meta
    .prepare(
      `SELECT u.id AS userId, u.username AS email, u.name, u.status, m.role, m.created_at
       FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? ORDER BY m.created_at`
    )
    .all(req.params.id)
  res.json(rows)
})

// Invite a member by email (admin). Existing accounts are added directly;
// unknown/pending emails get a pending account + an invite link (emailed in a
// later phase). The link is always returned so it works without SMTP.
app.post('/api/workspaces/:id/members', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const email = (req.body?.email || '').trim().toLowerCase()
  if (!email) return res.status(400).json({ error: 'Email is required.' })

  let target = getUserByEmail(email)
  if (target && memberRole(req.params.id, target.id)) {
    return res.status(400).json({ error: 'That person is already a member.' })
  }

  const now = Date.now()
  const expires = now + 7 * 24 * 60 * 60 * 1000 // 7 days
  let inviteLink = null
  if (!target) {
    const uid = randomUUID()
    const token = randomUUID()
    meta
      .prepare('INSERT INTO users (id, username, password_hash, name, role, status, invite_token, invite_workspace, token_expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uid, email, '', email, 'member', 'pending', token, req.params.id, expires)
    target = { id: uid, username: email, status: 'pending' }
    inviteLink = `${baseUrl(req)}/invite/${token}`
  } else if (target.status === 'pending') {
    const token = randomUUID()
    meta
      .prepare('UPDATE users SET invite_token = ?, invite_workspace = ?, token_expires = ? WHERE id = ?')
      .run(token, req.params.id, expires, target.id)
    inviteLink = `${baseUrl(req)}/invite/${token}`
  }

  meta
    .prepare('INSERT OR IGNORE INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), req.params.id, target.id, 'member', now)

  // Email the invite link when SMTP is configured — non-fatal, link is returned regardless.
  let emailed = false
  if (inviteLink) {
    const ws = meta.prepare('SELECT name, settings FROM workspaces WHERE id = ?').get(req.params.id)
    const cfg = smtpConfig(ws)
    if (cfg) {
      try {
        await sendInviteEmail(cfg, { to: email, workspaceName: ws.name, link: inviteLink })
        emailed = true
      } catch (e) {
        console.error('Invite email failed:', e.message)
      }
    }
  }

  res.json({
    member: { userId: target.id, email, name: target.name || email, role: 'member', status: target.status },
    inviteLink,
    emailed,
  })
})

// Remove a member (admin). Can't remove yourself or the last admin.
app.delete('/api/workspaces/:id/members/:userId', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  if (req.params.userId === user.id) return res.status(400).json({ error: "You can't remove yourself." })
  const role = memberRole(req.params.id, req.params.userId)
  if (!role) return res.status(404).json({ error: 'Member not found' })
  if (role === 'admin') {
    const admins = meta.prepare("SELECT COUNT(*) c FROM workspace_members WHERE workspace_id = ? AND role = 'admin'").get(req.params.id).c
    if (admins <= 1) return res.status(400).json({ error: 'The workspace needs at least one admin.' })
  }
  meta.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').run(req.params.id, req.params.userId)
  // Clean up a pending user that no longer belongs to any workspace.
  const left = meta.prepare('SELECT COUNT(*) c FROM workspace_members WHERE user_id = ?').get(req.params.userId).c
  const u = meta.prepare('SELECT status FROM users WHERE id = ?').get(req.params.userId)
  if (left === 0 && u?.status === 'pending') meta.prepare('DELETE FROM users WHERE id = ?').run(req.params.userId)
  res.json({ ok: true })
})

// ============================================================================
// Connections (scoped to a workspace the caller belongs to)
// ============================================================================

// List connections for a workspace.
app.get('/api/connections', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const workspaceId = req.query.workspace
  if (!workspaceId) return res.json([])
  if (!memberRole(workspaceId, user.id)) return res.status(403).json({ error: 'Forbidden' })
  res.json(listConnections().filter((c) => c.workspaceId === workspaceId))
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

// Add connection to a workspace.
app.post('/api/connections', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const workspaceId = req.body.workspaceId
  if (!workspaceId || !memberRole(workspaceId, user.id)) return res.status(403).json({ error: 'Forbidden' })
  const conn = { ...req.body, id: randomUUID(), workspaceId }
  saveConnection(conn)
  res.json(conn)
})

// Guard every per-connection route: caller must be a member of the connection's
// workspace. One mount covers PUT/DELETE /:id and all /:id/* data routes.
app.use('/api/connections/:id', (req, res, next) => {
  const user = requireAuth(req, res)
  if (!user) return
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  if (conn.workspaceId && !memberRole(conn.workspaceId, user.id)) return res.status(403).json({ error: 'Forbidden' })
  next()
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
