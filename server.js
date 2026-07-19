#!/usr/bin/env node
/**
 * Backend server for database management
 * Handles SQLite and PostgreSQL connections
 */

import express from 'express'
import cors from 'cors'
import fs from 'fs'
import os from 'os'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID, createHash, randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto'
import vm from 'node:vm'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'
import Database from 'better-sqlite3'
import nodemailer from 'nodemailer'
import cron from 'node-cron'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'
import pkg from 'pg'
import { migrate } from './server/migrations.js'
const { Client, Pool } = pkg

const execFileAsync = promisify(execFile)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

// Connection credentials (host/port/username/password/…) are encrypted at rest
// with this key. Required — refuse to boot rather than silently store secrets
// in plaintext.
if (!process.env.ENCRYPTION_KEY) {
  console.error('❌ ENCRYPTION_KEY is not set. Set it in your environment (see .env.example) before starting the server.')
  process.exit(1)
}

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

// ---- App identity (baked into the image at build time; package.json in dev) ----
// Reported by /api/system/version and /api/health, and compared against the
// latest published release to decide whether an update is available.
let APP_VERSION = process.env.APP_VERSION || ''
if (!APP_VERSION) {
  try {
    APP_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || '0.0.0'
  } catch {
    APP_VERSION = '0.0.0'
  }
}
const GIT_SHA = process.env.GIT_SHA || 'dev'
const APP_NAME = 'tabletsgo'

// App-level snapshots of the meta DB (users/connections/etc.) — distinct from the
// S3 database backups feature. Both the boot pre-migration snapshot and the
// update wizard's manual backup land here.
const BACKUPS_DIR = path.join(path.dirname(META_DB_PATH), 'backups')

// Boot readiness — flipped true once initMetaDb() has finished (migrations done).
let bootReady = false

// A safe synchronous snapshot of the meta DB: checkpoint the WAL so the main
// file is complete, then copy it. Safe at boot (no concurrent writers) and
// reused by the update wizard's backup endpoint.
function snapshotMetaSync(destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  try {
    meta.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // Best-effort — a busy WAL just means the copy may trail the newest write.
  }
  fs.copyFileSync(META_DB_PATH, destPath)
  return fs.statSync(destPath).size
}

const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex')

// ---- Connection credential encryption (AES-256-GCM) ----
const CRED_KEY = scryptSync(process.env.ENCRYPTION_KEY, 'tabletsgo-connections', 32)
// Storage destination credentials (S3 access/secret keys) use a distinct
// derived key — same passphrase, different scrypt salt — for namespace
// separation from connection credentials.
const STORAGE_CRED_KEY = scryptSync(process.env.ENCRYPTION_KEY, 'tabletsgo-storage', 32)
// Optional at-rest encryption for backup files before upload — same passphrase,
// yet another derived key for namespace separation.
const BACKUP_FILE_KEY = scryptSync(process.env.ENCRYPTION_KEY, 'tabletsgo-backup-file', 32)
function encryptSecret(plaintext, key = CRED_KEY) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`
}
function decryptSecret(payload, key = CRED_KEY) {
  if (!payload) return ''
  const [ivHex, tagHex, dataHex] = payload.split(':')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
}

function initMetaDb() {
  // Versioned, stepped migrations (see server/migrations.js): each pending step
  // runs in its own transaction and stamps PRAGMA user_version. The snapshot
  // hook copies the meta DB to data/backups/ before the first pending step
  // touches an existing install, so a bad upgrade can be rolled back by
  // restoring the file.
  migrate(meta, {
    encryptSecret,
    snapshot(fromVersion) {
      try {
        const dest = path.join(BACKUPS_DIR, `pre-migrate-v${fromVersion}-${Date.now()}.db`)
        const size = snapshotMetaSync(dest)
        console.log(`🛟 Pre-migration meta snapshot: ${dest} (${size} bytes)`)
      } catch (e) {
        console.error('⚠️  Pre-migration snapshot failed:', e.message)
      }
    },
  })

  // Optional pre-seed from env — skips the first-run setup wizard.
  const hasUsers = !!meta.prepare('SELECT 1 FROM users LIMIT 1').get()
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
}
initMetaDb()
bootReady = true

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

// ---- Team / connection-access helpers ----
// Team ids the user belongs to within a given workspace.
const teamIdsForUser = (workspaceId, userId) =>
  meta
    .prepare(
      `SELECT tm.team_id AS id FROM team_members tm JOIN teams t ON t.id = tm.team_id
       WHERE t.workspace_id = ? AND tm.user_id = ?`
    )
    .all(workspaceId, userId)
    .map((r) => r.id)

// Assigned principals for a connection, split into team/user id arrays.
const connectionAccess = (connectionId) => {
  const rows = meta.prepare('SELECT principal_type, principal_id FROM connection_access WHERE connection_id = ?').all(connectionId)
  return {
    teams: rows.filter((r) => r.principal_type === 'team').map((r) => r.principal_id),
    users: rows.filter((r) => r.principal_type === 'user').map((r) => r.principal_id),
  }
}

// Replace a connection's access list atomically. Empty arrays => open to all members.
const setConnectionAccess = (connectionId, { teams = [], users = [] }) => {
  const now = Date.now()
  const tx = meta.transaction(() => {
    meta.prepare('DELETE FROM connection_access WHERE connection_id = ?').run(connectionId)
    const ins = meta.prepare('INSERT OR IGNORE INTO connection_access (id, connection_id, principal_type, principal_id, created_at) VALUES (?, ?, ?, ?, ?)')
    for (const t of teams) ins.run(randomUUID(), connectionId, 'team', t, now)
    for (const u of users) ins.run(randomUUID(), connectionId, 'user', u, now)
  })
  tx()
}

// Can this user see/open the connection? Admins always can; an unassigned
// connection is open to every workspace member; otherwise the user must be a
// listed individual or belong to a listed team.
const userCanAccessConnection = (conn, userId) => {
  if (!conn) return false
  if (!conn.workspaceId) return true
  const role = memberRole(conn.workspaceId, userId)
  if (!role) return false
  if (role === 'admin') return true
  const { teams, users } = connectionAccess(conn.id)
  if (teams.length === 0 && users.length === 0) return true
  if (users.includes(userId)) return true
  if (teams.length === 0) return false
  const myTeams = new Set(teamIdsForUser(conn.workspaceId, userId))
  return teams.some((t) => myTeams.has(t))
}
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
// Nodemailer's defaults (2min connect/socket timeout) make a bad host hang
// the request for minutes instead of failing fast — cap it well below that.
const SMTP_TIMEOUTS = { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 }

const sendInviteEmail = async (cfg, { to, workspaceName, link }) => {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    ...SMTP_TIMEOUTS,
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
    ...SMTP_TIMEOUTS,
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
// Credentials (host/port/username/password/filepath/database/…) live encrypted
// in the `credentials` column; everything dialect-agnostic is a plain column.
// `rowToConnection` reassembles the flat shape the frontend has always used, so
// no client code needs to know storage changed.
function rowToConnection(row) {
  if (!row) return null
  let credentials = {}
  if (row.credentials) {
    try {
      credentials = JSON.parse(decryptSecret(row.credentials))
    } catch {
      credentials = {}
    }
  }
  let tags = []
  try {
    tags = JSON.parse(row.tags || '[]')
  } catch {
    tags = []
  }
  // Resolve the owner's display fields (best-effort) so the detail view can show
  // who owns the connection without a second round-trip.
  let ownerName, ownerEmail
  if (row.owner_id) {
    const u = meta.prepare('SELECT name, username FROM users WHERE id = ?').get(row.owner_id)
    if (u) {
      ownerName = u.name || u.username
      ownerEmail = u.username
    }
  }
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    workspaceId: row.workspace_id || undefined,
    environment: row.environment || undefined,
    folder: row.folder || '',
    tags,
    schemaVersion: row.schema_version || 1,
    ...credentials,
    ownerId: row.owner_id || undefined,
    ownerName,
    ownerEmail,
  }
}
// Split a flat connection object back into row columns + encrypted credentials.
// Owner + resolved owner display fields are peeled off so they never end up in
// the encrypted credentials blob.
function connectionToRow(conn) {
  const { id, type, name, workspaceId, environment, folder, tags, schemaVersion, ownerId, ownerName, ownerEmail, ...credentials } = conn
  return {
    id,
    type: type || null,
    name: name || null,
    workspace_id: workspaceId || null,
    environment: environment || null,
    folder: folder || '',
    tags: JSON.stringify(tags || []),
    credentials: encryptSecret(JSON.stringify(credentials)),
    schema_version: schemaVersion || 1,
    owner_id: ownerId || null,
  }
}

const listConnections = () => meta.prepare('SELECT * FROM connections ORDER BY created_at').all().map(rowToConnection)
const getConnection = (id) => rowToConnection(meta.prepare('SELECT * FROM connections WHERE id = ?').get(id))
const saveConnection = (conn) => {
  const row = connectionToRow(conn)
  const now = Date.now()
  meta
    .prepare(
      // `data` is a placeholder — installs predating this migration created it
      // as `data TEXT NOT NULL`, so every write must still supply *something*.
      `INSERT OR REPLACE INTO connections
       (id, type, name, workspace_id, environment, folder, tags, credentials, schema_version, owner_id, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', COALESCE((SELECT created_at FROM connections WHERE id = ?), ?), ?)`
    )
    .run(row.id, row.type, row.name, row.workspace_id, row.environment, row.folder, row.tags, row.credentials, row.schema_version, row.owner_id, row.id, now, now)
}
const deleteConnectionRow = (id) => meta.prepare('DELETE FROM connections WHERE id = ?').run(id)
// Bump a connection's schema version after a successful DDL commit. Direct
// column update — avoids round-tripping (and re-encrypting) the full row.
const bumpSchemaVersion = (id) => {
  meta.prepare('UPDATE connections SET schema_version = schema_version + 1, updated_at = ? WHERE id = ?').run(Date.now(), id)
  return meta.prepare('SELECT schema_version FROM connections WHERE id = ?').get(id)?.schema_version
}

// Execute one SQL statement against a connection's target database, dispatching
// on dialect. Shared by the /query endpoint and schema rollback. Throws on error.
async function execSqlOnConnection(conn, sql, database, schema) {
  if (conn.type === 'sqlite') {
    return runSqliteQuery(getSqliteDb(conn.filepath), sql)
  } else if (conn.type === 'postgresql') {
    return runPostgresQuery(getPostgresPool(conn, database), sql, schema)
  }
  throw new Error(`Unsupported connection type: ${conn.type}`)
}

// ---- Storage destination helpers (S3-compatible: AWS S3, MinIO, R2, B2, …) ----
// Same split as connections: dialect-agnostic fields as plain columns, the
// access/secret key pair encrypted into `credentials` (with a distinct key).
function rowToStorage(row) {
  if (!row) return null
  let credentials = {}
  if (row.credentials) {
    try {
      credentials = JSON.parse(decryptSecret(row.credentials, STORAGE_CRED_KEY))
    } catch {
      credentials = {}
    }
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    endpoint: row.endpoint || '',
    region: row.region || '',
    bucket: row.bucket,
    pathPrefix: row.path_prefix || '',
    forcePathStyle: !!row.force_path_style,
    accessKeyId: credentials.accessKeyId || '',
    secretAccessKey: credentials.secretAccessKey || '',
    sessionToken: credentials.sessionToken || undefined,
  }
}
// A reserved, always-available destination that stores backups on the server's
// own disk (under data/backups) instead of an S3 bucket — the default when a
// connection's backup schedule has no S3 destination configured ("not
// integrated with S3"). It flows through the whole backup pipeline like any
// other destination (store, prune, download, delete, restore); each step
// branches on `dest.local` instead of talking to S3.
const LOCAL_STORAGE_ID = 'local'
const LOCAL_BACKUP_DIR = path.join(__dirname, 'data', 'backups')
fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true })
const localStorageDest = () => ({
  id: LOCAL_STORAGE_ID,
  workspaceId: null,
  name: 'Local server disk',
  local: true,
  endpoint: '',
  region: '',
  bucket: '',
  pathPrefix: '',
  forcePathStyle: false,
  accessKeyId: '',
  secretAccessKey: '',
})
const getStorage = (id) =>
  id === LOCAL_STORAGE_ID
    ? localStorageDest()
    : rowToStorage(meta.prepare('SELECT * FROM storage_destinations WHERE id = ?').get(id))
const listStorageRows = (workspaceId) =>
  meta.prepare('SELECT * FROM storage_destinations WHERE workspace_id = ? ORDER BY created_at').all(workspaceId).map(rowToStorage)

// Build an S3 client for a storage destination. Cached per destination id so
// repeated uploads (e.g. within one backup run) reuse the same client.
const s3Clients = new Map()
function getS3Client(dest) {
  if (!s3Clients.has(dest.id)) {
    s3Clients.set(
      dest.id,
      new S3Client({
        endpoint: dest.endpoint || undefined,
        region: dest.region || 'us-east-1',
        forcePathStyle: !!dest.forcePathStyle,
        credentials: {
          accessKeyId: dest.accessKeyId,
          secretAccessKey: dest.secretAccessKey,
          sessionToken: dest.sessionToken,
        },
      })
    )
  }
  return s3Clients.get(dest.id)
}

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
  // SQLite auto-assigns only the rowid alias: the sole PK column declared
  // exactly INTEGER, on a table that has a rowid. That reads as no default in
  // PRAGMA table_info, so it has to be derived. The AUTOINCREMENT keyword is a
  // rowid-reuse policy on that same column, not a separate case.
  const ddl =
    db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)?.sql || ''
  const withoutRowid = /WITHOUT\s+ROWID/i.test(ddl)
  const pkCols = cols.filter((c) => c.pk)
  const rowidAlias =
    !withoutRowid && pkCols.length === 1 && /^integer$/i.test((pkCols[0].type || '').trim())
      ? pkCols[0].name
      : null
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

// Connection args + libpq env for the pg_dump/pg_restore CLIs, mirroring
// pgConfig so the tools honour the same host/port/db, no-auth mode, and SSL
// mode as the pooled client. Password and sslmode go through libpq env vars
// (PGPASSWORD/PGSSLMODE) — never argv — so they don't leak into the process list.
function pgToolConn(conn) {
  const noAuth = conn.auth === 'none'
  const args = ['-h', conn.host, '-p', String(conn.port || 5432), '-d', conn.database]
  if (!noAuth && conn.username) args.push('-U', conn.username)
  const env = { ...process.env, PGPASSWORD: noAuth ? '' : conn.password || '' }
  if (conn.sslmode) env.PGSSLMODE = conn.sslmode
  return { args, env }
}

// Runs a PostgreSQL CLI tool (pg_dump/pg_restore), translating the cryptic
// `spawn <tool> ENOENT` you get when the client tools aren't installed/on PATH
// into an actionable message (the dump/restore server requirement).
async function execPgTool(tool, args, opts) {
  try {
    return await execFileAsync(tool, args, opts)
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `${tool} not found on the server — PostgreSQL backup/restore needs the PostgreSQL client tools (pg_dump/pg_restore) installed and on PATH.`
      )
    }
    throw err
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

// `pg_proc.prokind` only exists on PostgreSQL 11+; older servers (and some
// wire-compatible ones, e.g. Redshift) classify functions with the proisagg /
// proiswindow booleans instead. A server can't change version under a live
// pool, so cache the lookup per pool. An unreadable version falls back to the
// pre-11 form, which is the safer guess for anything not answering `SHOW`.
const postgresVersions = new WeakMap()

async function postgresVersionNum(pool) {
  if (!postgresVersions.has(pool)) {
    let num = 0
    try {
      const r = await pool.query('SHOW server_version_num')
      num = parseInt(r.rows[0]?.server_version_num, 10) || 0
    } catch (error) {
      num = 0
    }
    postgresVersions.set(pool, num)
  }
  return postgresVersions.get(pool)
}

// SQL predicate selecting plain functions (not aggregates/window functions/procedures).
async function pgPlainFunctionFilter(pool) {
  const version = await postgresVersionNum(pool)
  return version >= 110000 ? `p.prokind = 'f'` : `NOT p.proisagg AND NOT p.proiswindow`
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
       WHERE n.nspname = $1 AND ${await pgPlainFunctionFilter(pool)}
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
    `SELECT column_name, data_type, is_nullable, column_default, is_identity,
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
  // serial exposes its sequence as a nextval() default; identity columns keep it
  // out of column_default entirely, so both have to be checked.
  return r.rows.map((c) => ({
    name: c.column_name,
    type: pgFullType(c),
    notnull: c.is_nullable === 'NO',
    pk: pkSet.has(c.column_name),
    default: c.column_default,
    autoIncrement: c.is_identity === 'YES' || /^nextval\(/i.test(c.column_default || ''),
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
     WHERE n.nspname = $1 AND p.proname = $2 AND ${await pgPlainFunctionFilter(pool)}
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
// Query analyzer (POST /api/connections/:id/analyze)
// ============================================================================
// Runs the dialect's EXPLAIN machinery on one statement and normalizes the
// result into a dialect-agnostic shape: a plan (with per-row warnings), index
// suggestions (ready-to-run CREATE INDEX DDL, deduped against existing
// indexes) and query-level suggestions. Read-only SELECTs are additionally
// executed for real timings ("actual"); anything else stays estimate-only so
// analysis can never modify data.

// Strip -- and /* */ comments, respecting string literals.
function stripSqlComments(sql) {
  let out = ''
  let i = 0
  let quote = null // ', ", or `
  while (i < sql.length) {
    const ch = sql[i]
    if (quote) {
      out += ch
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      out += ch
      i++
      continue
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
      out += ' '
      continue
    }
    out += ch
    i++
  }
  return out
}

// Split on ';' outside string literals. Used only to reject multi-statement
// input — the analyzer works on exactly one statement.
function splitSqlStatements(sql) {
  const parts = []
  let cur = ''
  let quote = null
  for (const ch of sql) {
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      cur += ch
      continue
    }
    if (ch === ';') {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)
  return parts.map((p) => p.trim()).filter(Boolean)
}

// Classify the statement to pick the safe analysis mode. Returns
// { kind: 'select' | 'dml', readOnly } or throws for unsupported statements.
// A SELECT counts as read-only only when no write keyword appears anywhere
// (covers data-modifying CTEs); a false positive merely downgrades to
// estimates, never executes anything.
function classifyStatement(sql) {
  const first = (sql.match(/^\s*([a-z]+)/i)?.[1] || '').toLowerCase()
  if (first === 'select' || first === 'with' || first === 'values') {
    const readOnly = !/\b(insert|update|delete|merge|replace)\b/i.test(sql)
    return { kind: 'select', readOnly }
  }
  if (first === 'insert' || first === 'update' || first === 'delete' || first === 'replace' || first === 'merge') {
    return { kind: 'dml', readOnly: false }
  }
  throw new Error('Only SELECT and data-modification statements can be analyzed.')
}

// Candidate columns referenced in WHERE/ON comparisons and ORDER BY. Regex
// extraction only — each candidate is validated against the table's real
// column list before use, so sloppiness here is harmless.
function extractQueryColumns(sql) {
  // For UPDATE/DELETE only the WHERE clause matters — SET assignments would
  // otherwise read as comparisons and pollute the index suggestion.
  let scope = sql
  if (/^\s*(update|delete)\b/i.test(sql)) {
    const w = sql.search(/\bwhere\b/i)
    scope = w >= 0 ? sql.slice(w) : ''
  }
  const where = []
  const compRe = /(?:"([^"]+)"|\b([a-z_][\w]*))\s*(?:=|<>|!=|<=|>=|<|>|\s+(?:not\s+)?(?:in|like|between|is)\b)/gi
  let m
  while ((m = compRe.exec(scope))) {
    const name = (m[1] || m[2] || '').split('.').pop()
    if (name && !/^(select|from|where|and|or|not|on|join|inner|left|right|outer|as|case|when|then|else|end|null|true|false|in|like|between|is|exists)$/i.test(name)) {
      where.push(name)
    }
  }
  const orderBy = []
  const om = sql.match(/\border\s+by\b([\s\S]*?)(\blimit\b|\boffset\b|$)/i)
  if (om) {
    for (const part of om[1].split(',')) {
      const col = part
        .replace(/\b(asc|desc|nulls\s+(first|last))\b/gi, '')
        .trim()
        .replace(/^"|"$/g, '')
        .split('.')
        .pop()
      if (col && /^[\w]+$/.test(col)) orderBy.push(col)
    }
  }
  return { where: [...new Set(where)], orderBy: [...new Set(orderBy)] }
}

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`

function buildIndexDdl(table, columns, schema) {
  const base = `idx_${table}_${columns.join('_')}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 60)
  const target = schema && schema !== 'public' ? `${quoteIdent(schema)}.${quoteIdent(table)}` : quoteIdent(table)
  return `CREATE INDEX ${quoteIdent(base)} ON ${target} (${columns.map(quoteIdent).join(', ')});`
}

// True when an existing index already leads with the suggestion's first
// column — the case where a new index would be redundant.
function hasCoveringIndex(existing, columns) {
  const lead = (columns[0] || '').toLowerCase()
  return existing.some((idx) => (idx.columns || '').split(',')[0]?.trim().toLowerCase() === lead)
}

// Filter suggestion candidates down to real columns and dedupe.
function makeIndexSuggestion(table, candidates, realColumns, existingIndexes, reason, schema) {
  const real = new Set(realColumns.map((c) => c.name.toLowerCase()))
  const cols = candidates.filter((c) => real.has(c.toLowerCase()))
  if (!cols.length || hasCoveringIndex(existingIndexes, cols)) return null
  return { table, columns: cols, reason, ddl: buildIndexDdl(table, cols, schema) }
}

// Query-level suggestions shared by both dialects.
function queryLevelSuggestions(sql, plan, primaryTableColumnCount) {
  const out = []
  if (/select\s+\*/i.test(sql) && primaryTableColumnCount > 10) {
    out.push({ code: 'select-star', message: `SELECT * fetches ${primaryTableColumnCount} columns; select only the columns you need.` })
  }
  if (/\blike\s+'%/i.test(sql)) {
    out.push({ code: 'leading-wildcard-like', message: "LIKE with a leading wildcard ('%…') cannot use an index — consider full-text search or a suffix strategy." })
  }
  const hasFullScan = plan.some((p) => p.warning && /full table scan/i.test(p.warning))
  if (hasFullScan && !/\blimit\b/i.test(sql) && !/\b(count|sum|avg|min|max|group\s+by)\b/i.test(sql)) {
    out.push({ code: 'full-scan-no-limit', message: 'Full table scan without LIMIT may return the whole table — add a LIMIT or a WHERE clause an index can serve.' })
  }
  return out
}

async function analyzeSqlite(db, sql, cls) {
  const eqp = runSqliteQuery(db, `EXPLAIN QUERY PLAN ${sql}`)
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
    const run = runSqliteQuery(db, sql)
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
        columnsByTable.set(table, getSqliteColumns(db, table))
      } catch {
        columnsByTable.set(table, [])
      }
    }
    return columnsByTable.get(table)
  }
  const scannedTables = [...new Set(plan.filter((p) => p.warning === 'Full table scan' && p.table).map((p) => p.table))]
  for (const table of scannedTables) {
    const sug = makeIndexSuggestion(
      table, where, colsFor(table), getSqliteIndexes(db, table),
      `Full table scan on ${quoteIdent(table)} while filtering — an index on the filtered column(s) would let SQLite seek instead of scan.`
    )
    if (sug) indexSuggestions.push(sug)
  }
  if (plan.some((p) => p.warning === 'Sort without index (temp B-tree)') && orderBy.length) {
    // Attribute the sort to the first scanned/searched table.
    const table = plan.find((p) => p.table)?.table
    if (table) {
      const sug = makeIndexSuggestion(
        table, orderBy, colsFor(table), getSqliteIndexes(db, table),
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

async function analyzePostgres(pool, sql, schema, cls) {
  const analyze = cls.kind === 'select' && cls.readOnly
  const explain = await runPostgresQuery(pool, `EXPLAIN (FORMAT JSON${analyze ? ', ANALYZE' : ''}) ${sql}`, schema)
  if (explain.error) throw new Error(explain.error)

  // FORMAT JSON returns one row with a single "QUERY PLAN" value — node-pg may
  // hand it over pre-parsed (json type) or as a string.
  const raw = explain.rows?.[0]?.['QUERY PLAN']
  const tree = typeof raw === 'string' ? JSON.parse(raw) : raw
  const root = Array.isArray(tree) ? tree[0] : tree
  if (!root?.Plan) throw new Error('Unexpected EXPLAIN output.')

  // Walk the plan tree depth-first into normalized rows.
  const plan = []
  const walk = (node, depth) => {
    const details = []
    if (node['Join Type']) details.push(`${node['Join Type']} join`)
    if (node['Index Cond']) details.push(`Index Cond: ${node['Index Cond']}`)
    if (node.Filter) details.push(`Filter: ${node.Filter}`)
    if (node['Sort Key']) details.push(`Sort Key: ${Array.isArray(node['Sort Key']) ? node['Sort Key'].join(', ') : node['Sort Key']}`)
    if (node['Sort Method']) details.push(`Sort Method: ${node['Sort Method']}`)
    let warning = null
    if (node['Node Type'] === 'Seq Scan' && node.Filter) warning = 'Full table scan with filter'
    else if (node['Node Type'] === 'Seq Scan') warning = 'Full table scan'
    else if (node['Node Type'] === 'Sort' && String(node['Sort Method'] || '').toLowerCase().startsWith('external')) warning = 'Sort spilled to disk'
    plan.push({
      depth,
      step: node['Node Type'],
      detail: details.join(' · ') || node['Node Type'],
      table: node['Relation Name'] || null,
      index: node['Index Name'] || null,
      rows: node['Actual Rows'] ?? node['Plan Rows'] ?? null,
      warning,
      sortKey: node['Sort Key'] || null, // internal, stripped below
      filter: node.Filter || null, // internal, stripped below
    })
    for (const child of node.Plans || []) walk(child, depth + 1)
  }
  walk(root.Plan, 0)

  const summary = analyze
    ? {
        mode: 'actual',
        executed: true,
        elapsedMs: Math.round(((root['Planning Time'] || 0) + (root['Execution Time'] || 0)) * 100) / 100,
        estimatedCost: root.Plan['Total Cost'],
        rowsReturned: root.Plan['Actual Rows'] ?? null,
      }
    : { mode: 'estimated', executed: false, estimatedCost: root.Plan['Total Cost'] }

  // Suggestions straight from the plan: Seq Scan filters and Sort keys.
  const identRe = /(?:"([^"]+)"|\b([a-z_][\w]*))\s*(?:=|<>|!=|<=|>=|<|>|\s+(?:not\s+)?(?:in|like|between|is)\b)/gi
  const indexSuggestions = []
  const metaCache = new Map()
  const metaFor = async (table) => {
    if (!metaCache.has(table)) {
      metaCache.set(table, {
        columns: await getPostgresColumns(pool, table, schema || 'public'),
        indexes: await getPostgresIndexes(pool, table, schema || 'public'),
      })
    }
    return metaCache.get(table)
  }
  for (const row of plan) {
    if (row.warning === 'Full table scan with filter' && row.table) {
      const cands = []
      let m
      while ((m = identRe.exec(row.filter))) cands.push((m[1] || m[2]).split('.').pop())
      identRe.lastIndex = 0
      const { columns, indexes } = await metaFor(row.table)
      const sug = makeIndexSuggestion(
        row.table, [...new Set(cands)], columns, indexes,
        `Sequential scan on ${quoteIdent(row.table)} while filtering — an index on the filtered column(s) would let Postgres use an index scan.`,
        schema
      )
      if (sug && !indexSuggestions.some((s) => s.ddl === sug.ddl)) indexSuggestions.push(sug)
    }
    if (row.step === 'Sort' && row.sortKey) {
      // Only worth an index when the sort feeds off a full scan.
      const scanBelow = plan.find((p) => p.depth > row.depth && p.table && (p.warning || '').startsWith('Full table scan'))
      if (scanBelow) {
        const keys = (Array.isArray(row.sortKey) ? row.sortKey : [row.sortKey])
          .map((k) => String(k).replace(/\b(asc|desc|nulls\s+(first|last))\b/gi, '').trim().replace(/^"|"$/g, '').split('.').pop())
          .filter((k) => /^[\w]+$/.test(k))
        const { columns, indexes } = await metaFor(scanBelow.table)
        const sug = makeIndexSuggestion(
          scanBelow.table, keys, columns, indexes,
          `Sort on ${quoteIdent(scanBelow.table)} — an index on the sort key(s) delivers rows pre-sorted.`,
          schema
        )
        if (sug && !indexSuggestions.some((s) => s.ddl === sug.ddl)) indexSuggestions.push(sug)
      }
    }
  }
  for (const row of plan) {
    delete row.sortKey
    delete row.filter
  }

  const primaryTable = plan.find((p) => p.table)?.table
  const primaryCols = primaryTable ? (await metaFor(primaryTable)).columns.length : 0
  const querySuggestions = queryLevelSuggestions(sql, plan, primaryCols)

  return {
    dialect: 'postgresql',
    summary,
    plan,
    rawPlan: { columns: ['QUERY PLAN'], rows: [{ 'QUERY PLAN': JSON.stringify(tree, null, 2) }] },
    indexSuggestions,
    querySuggestions,
  }
}

// ============================================================================
// Workflow executor
// ============================================================================
// SECURITY: workflows run arbitrary SQL, make server-side HTTP requests (can
// reach internal URLs — SSRF) and evaluate user JavaScript. `node:vm` is NOT a
// hard security boundary. This is acceptable here because only authenticated
// workspace members can create/run workflows — the same trust level as the
// existing "run any SQL" query editor. Do not expose this to untrusted users.

const safeJson = (s) => {
  try {
    return typeof s === 'string' ? JSON.parse(s) : s || {}
  } catch {
    return {}
  }
}
// Bound a value for a JSON response: keep it structured when small, else a
// truncated string.
function jsonPreview(v, max = 800) {
  let s
  try {
    s = JSON.stringify(v)
  } catch {
    s = String(v)
  }
  if (s === undefined) return null
  return s.length > max ? s.slice(0, max) + '… (truncated)' : v
}

// Run a user JS snippet in a sandbox. `code` is a function body that receives
// `input` and returns a value. 3s CPU timeout, no require/process/fs.
function runUserJs(code, input) {
  const logs = []
  const sandbox = {
    input,
    console: { log: (...a) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) },
    __out: undefined,
  }
  vm.createContext(sandbox)
  const script = new vm.Script(`__out = (function(input){ ${code}\n})(input)`)
  script.runInContext(sandbox, { timeout: 3000 })
  return { out: sandbox.__out, logs }
}

// Substitute {{input.path}} placeholders in a query node's SQL with values
// from the node's input (e.g. a dashboard table row), rendered as SQL literals.
// Dialect-agnostic on purpose: single-quoted strings with '' doubling, bare
// numeric literals, and NULL are valid in every roadmap dialect. Non-scalar
// values are an error, not silently stringified.
function substituteWorkflowInput(sql, input) {
  return sql.replace(/\{\{\s*input((?:\.[A-Za-z_][A-Za-z0-9_]*)+)\s*\}\}/g, (_, path) => {
    let v = input
    for (const key of path.slice(1).split('.')) v = v?.[key]
    if (v === null || v === undefined) return 'NULL'
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
    if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`
    throw new Error(`{{input${path}}} is not a scalar value (got ${Array.isArray(v) ? 'array' : typeof v})`)
  })
}

// Run one query node against the connection (dialect-dispatched).
async function execWorkflowQuery(conn, sql) {
  if (conn.type === 'sqlite') return runSqliteQuery(getSqliteDb(conn.filepath), sql)
  if (conn.type === 'postgresql') return runPostgresQuery(getPostgresPool(conn), sql, 'public')
  return { error: `Unsupported connection type: ${conn.type}` }
}

// ---- "Export SQL" / "Store to Storage" node execution ----
const BACKUP_TMP_DIR = path.join(__dirname, 'data', 'tmp-backups')
fs.mkdirSync(BACKUP_TMP_DIR, { recursive: true })
const sanitizeForKey = (s) => String(s || 'connection').replace(/[^a-zA-Z0-9._-]+/g, '-')
// The AWS SDK's undici-based HTTP handler throws an AggregateError with an
// empty `.message` for connection failures (ECONNREFUSED, DNS, TLS, …) — fall
// back to `.code` or the first aggregated error so callers see something useful.
const describeError = (err) => err.message || err.code || err.errors?.[0]?.message || String(err)

// Dumps the connection's full database to a local file, dialect-dispatched
// like execWorkflowQuery. Output: { filePath, sizeBytes, dialect }.
async function execExportSql(conn) {
  const tmpPath = path.join(BACKUP_TMP_DIR, `${randomUUID()}.dump`)
  if (conn.type === 'sqlite') {
    // better-sqlite3's online backup API — safe against a half-written page,
    // unlike a raw fs.copyFile of the live database file.
    await getSqliteDb(conn.filepath).backup(tmpPath)
  } else if (conn.type === 'postgresql') {
    const { args, env } = pgToolConn(conn)
    await execPgTool('pg_dump', ['-Fc', '--no-owner', '-f', tmpPath, ...args], { env })
  } else {
    throw new Error(`Export not supported for connection type: ${conn.type}`)
  }
  const sizeBytes = fs.statSync(tmpPath).size
  return { filePath: tmpPath, sizeBytes, dialect: conn.type }
}

// On-disk format for an encrypted backup file: [12B IV][ciphertext][16B authTag].
// Streamed both ways so file size never buffers fully in memory.
async function encryptFileToFile(srcPath, key = BACKUP_FILE_KEY) {
  const destPath = `${srcPath}.enc`
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const out = fs.createWriteStream(destPath)
  await new Promise((resolve, reject) => out.write(iv, (err) => (err ? reject(err) : resolve())))
  await pipeline(fs.createReadStream(srcPath), cipher, out) // ends `out` once the cipher finishes
  await fs.promises.appendFile(destPath, cipher.getAuthTag())
  return destPath
}
async function decryptFileToFile(srcPath, key = BACKUP_FILE_KEY) {
  const destPath = `${srcPath}.dec`
  const size = fs.statSync(srcPath).size
  const ivBuf = Buffer.alloc(12)
  const fd = fs.openSync(srcPath, 'r')
  fs.readSync(fd, ivBuf, 0, 12, 0)
  const tagBuf = Buffer.alloc(16)
  fs.readSync(fd, tagBuf, 0, 16, size - 16)
  fs.closeSync(fd)
  const decipher = createDecipheriv('aes-256-gcm', key, ivBuf)
  decipher.setAuthTag(tagBuf)
  await pipeline(fs.createReadStream(srcPath, { start: 12, end: size - 17 }), decipher, fs.createWriteStream(destPath))
  return destPath
}

// Uploads a file (from an upstream node's { filePath } output) to one or more
// storage destinations, streaming so the file is never buffered in memory.
// `opts.encrypt` encrypts the file with a server-derived key before upload;
// `opts.retentionDays` prunes older objects under the same key prefix after a
// successful upload (0/undefined = never delete).
async function execStoreToStorage(conn, input, destinationIds, opts = {}) {
  if (!destinationIds?.length) throw new Error('No storage destinations selected')
  const dateStr = new Date().toISOString().slice(0, 10)
  const uploaded = []
  let uploadPath = input.filePath
  let cleanupEncrypted = false
  if (opts.encrypt) {
    uploadPath = await encryptFileToFile(input.filePath)
    cleanupEncrypted = true
  }
  try {
    for (const destId of destinationIds) {
      const dest = getStorage(destId)
      if (!dest) {
        uploaded.push({ destinationId: destId, ok: false, error: 'Storage destination not found' })
        continue
      }
      const prefix = dest.pathPrefix ? `${dest.pathPrefix.replace(/^\/+|\/+$/g, '')}/` : ''
      const folder = `${prefix}${sanitizeForKey(conn.name)}/`
      try {
        const key = `${folder}${dateStr}/${path.basename(input.filePath)}${opts.encrypt ? '.enc' : ''}`
        if (dest.local) {
          const absPath = path.join(LOCAL_BACKUP_DIR, key)
          fs.mkdirSync(path.dirname(absPath), { recursive: true })
          await fs.promises.copyFile(uploadPath, absPath)
        } else {
          await getS3Client(dest).send(
            new PutObjectCommand({ Bucket: dest.bucket, Key: key, Body: fs.createReadStream(uploadPath) })
          )
        }
        const entry = { destinationId: destId, ok: true, key, sizeBytes: input.sizeBytes }
        if (opts.encrypt) entry.encrypted = true
        if (opts.retentionDays > 0) {
          try {
            entry.prunedCount = await pruneOldBackups(dest, folder, opts.retentionDays)
          } catch (err) {
            entry.pruneError = describeError(err)
          }
        }
        uploaded.push(entry)
      } catch (err) {
        uploaded.push({ destinationId: destId, ok: false, error: describeError(err) })
      }
    }
  } finally {
    if (cleanupEncrypted) fs.rm(uploadPath, { force: true }, () => {})
  }
  return { uploaded }
}

// Connection types a backup can be restored into.
const RESTORABLE_TYPES = new Set(['sqlite', 'postgresql'])

// True if the file starts with the SQLite magic header — keeps restore from
// overwriting a live database with a file that isn't a SQLite database at all.
function isSqliteFile(filePath) {
  const buf = Buffer.alloc(16)
  const fd = fs.openSync(filePath, 'r')
  const n = fs.readSync(fd, buf, 0, 16, 0)
  fs.closeSync(fd)
  return n === 16 && buf.toString('utf8', 0, 15) === 'SQLite format 3'
}

// Overwrites a connection's live data with the dump file at `dumpPath`.
// Shared by every restore path (backup run, storage browse, file upload) —
// the caller has already validated the target, its type, and the confirmation.
async function restoreDumpIntoConnection(targetConn, dumpPath) {
  if (targetConn.type === 'sqlite') {
    if (!isSqliteFile(dumpPath)) throw new Error('The file is not a SQLite database — refusing to overwrite the live database with it.')
    sqliteConnections.delete(targetConn.filepath)
    const swap = `${targetConn.filepath}.tmp`
    fs.copyFileSync(dumpPath, swap)
    fs.renameSync(swap, targetConn.filepath) // atomic replace of the live file
  } else if (targetConn.type === 'postgresql') {
    closePostgresPools(targetConn.id)
    const { args, env } = pgToolConn(targetConn)
    await execPgTool('pg_restore', ['--clean', '--if-exists', '--no-owner', ...args, dumpPath], { env })
  } else {
    throw new Error(`Restore not supported for connection type: ${targetConn.type}`)
  }
}

// Reads a stored object (S3 or local disk) into a local temp file. Shared by
// download/restore so neither has to know which kind of destination it is.
async function fetchStorageObjectToFile(dest, key, destPath) {
  if (dest.local) {
    await fs.promises.copyFile(path.join(LOCAL_BACKUP_DIR, key), destPath)
  } else {
    const obj = await getS3Client(dest).send(new GetObjectCommand({ Bucket: dest.bucket, Key: key }))
    await pipeline(obj.Body, fs.createWriteStream(destPath))
  }
}

// Lists a destination's stored files (newest first, capped) so the
// restore-from-storage picker can browse what's actually in the bucket/folder.
async function listStorageObjects(dest, limit = 500) {
  const objects = []
  if (dest.local) {
    const walk = (dir, rel) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const key = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.isDirectory()) walk(path.join(dir, entry.name), key)
        else {
          const st = fs.statSync(path.join(dir, entry.name))
          objects.push({ key, sizeBytes: st.size, lastModified: Math.round(st.mtimeMs) })
        }
      }
    }
    walk(LOCAL_BACKUP_DIR, '')
  } else {
    const client = getS3Client(dest)
    const prefix = dest.pathPrefix ? `${dest.pathPrefix.replace(/^\/+|\/+$/g, '')}/` : ''
    let ContinuationToken
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: dest.bucket, Prefix: prefix, ContinuationToken }))
      for (const obj of page.Contents || []) {
        if (obj.Key && !obj.Key.endsWith('/'))
          objects.push({ key: obj.Key, sizeBytes: obj.Size ?? 0, lastModified: obj.LastModified ? new Date(obj.LastModified).getTime() : null })
      }
      ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (ContinuationToken && objects.length < 5000)
  }
  objects.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0))
  return objects.slice(0, limit)
}

// Deletes stored objects (S3 or local disk) by key.
async function deleteStorageObjects(dest, keys) {
  if (!keys.length) return
  if (dest.local) {
    for (const key of keys) fs.rmSync(path.join(LOCAL_BACKUP_DIR, key), { force: true })
  } else {
    await getS3Client(dest).send(new DeleteObjectsCommand({ Bucket: dest.bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }))
  }
}

// Deletes local-disk backups under `folder` older than `retentionDays` worth of
// ms (cutoff). Layout mirrors the S3 keys: <folder>/<date>/<file>.
function pruneLocalBackups(folder, cutoff) {
  const root = path.join(LOCAL_BACKUP_DIR, folder)
  if (!fs.existsSync(root)) return 0
  let removed = 0
  for (const dateDir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dateDir.isDirectory()) continue
    const dirPath = path.join(root, dateDir.name)
    for (const file of fs.readdirSync(dirPath)) {
      const filePath = path.join(dirPath, file)
      if (fs.statSync(filePath).mtimeMs < cutoff) {
        fs.rmSync(filePath, { force: true })
        removed++
      }
    }
    if (fs.readdirSync(dirPath).length === 0) fs.rmSync(dirPath, { recursive: true, force: true })
  }
  return removed
}

// Deletes objects under `folder` older than `retentionDays`. Scoped to this
// connection's own backup prefix — never touches anything outside it.
async function pruneOldBackups(dest, folder, retentionDays) {
  const cutoff = Date.now() - retentionDays * 86400000
  if (dest.local) return pruneLocalBackups(folder, cutoff)
  const client = getS3Client(dest)
  const stale = []
  let ContinuationToken
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: dest.bucket, Prefix: folder, ContinuationToken }))
    for (const obj of page.Contents || []) {
      if (obj.Key && obj.LastModified && new Date(obj.LastModified).getTime() < cutoff) stale.push({ Key: obj.Key })
    }
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (ContinuationToken)
  if (!stale.length) return 0
  // S3 caps a single batch delete at 1000 keys.
  for (let i = 0; i < stale.length; i += 1000) {
    await client.send(new DeleteObjectsCommand({ Bucket: dest.bucket, Delete: { Objects: stale.slice(i, i + 1000) } }))
  }
  return stale.length
}

// Execute a workflow graph. Threads each node's output to its successor(s).
// Returns { ok, log, output, error? }.
async function runWorkflow(conn, graph, initialInput = null) {
  const nodes = new Map((graph?.nodes || []).map((n) => [n.id, n]))
  const edges = graph?.edges || []
  const outgoing = (id, handle = 'out') => edges.filter((e) => e.source === id && (e.sourceHandle || 'out') === handle)
  const log = []
  const started = Date.now()
  // Export/Store nodes dump+upload a whole database, which can take well past
  // 20s for a large one — give graphs using them a much longer budget than the
  // ordinary query/http/js automation graphs this guard is meant to bound.
  const isLongRunning = (graph?.nodes || []).some((n) => n.type === 'export' || n.type === 'storage')
  const OVERALL_MS = isLongRunning ? 30 * 60 * 1000 : 20000
  const STEP_BUDGET = 5000
  const MAX_ITER = 1000
  let steps = 0

  const guard = () => {
    if (++steps > STEP_BUDGET) throw new Error('Step budget exceeded — possible infinite loop.')
    if (Date.now() - started > OVERALL_MS) throw new Error('Workflow timed out (20s).')
  }

  // Compute a leaf node's output (schedule/query/http/js). Logs its own entry.
  async function evalLeaf(node, input) {
    const t0 = Date.now()
    const entry = { nodeId: node.id, nodeType: node.type, status: 'ok', ms: 0, output: undefined }
    log.push(entry)
    try {
      const d = node.data || {}
      let output
      if (node.type === 'schedule' || node.type === 'manual') {
        output = input // trigger node — pass the initial input straight through
      } else if (node.type === 'query') {
        if (!d.sql?.trim()) throw new Error('No query configured')
        const r = await execWorkflowQuery(conn, substituteWorkflowInput(d.sql, input))
        if (r.error) throw new Error(r.error)
        output = r.type === 'rows' ? { columns: r.columns, rows: r.rows } : { message: r.message }
      } else if (node.type === 'http') {
        if (!d.url?.trim()) throw new Error('No URL configured')
        const method = (d.method || 'GET').toUpperCase()
        const headers = typeof d.headers === 'string' ? safeJson(d.headers) : d.headers || {}
        const res = await fetch(d.url, {
          method,
          headers,
          body: method === 'GET' || method === 'HEAD' ? undefined : d.body || undefined,
        })
        const ct = res.headers.get('content-type') || ''
        const body = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text()
        output = { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers), body }
      } else if (node.type === 'js') {
        const { out, logs } = runUserJs(d.code || 'return input', input)
        if (logs.length) entry.logs = logs
        output = out
      } else if (node.type === 'export') {
        output = await execExportSql(conn)
      } else if (node.type === 'storage') {
        if (!input?.filePath) throw new Error('No file to store — connect this after a node that outputs a file (e.g. Export SQL)')
        output = await execStoreToStorage(conn, input, d.destinationIds || [], { encrypt: !!d.encrypt, retentionDays: d.retentionDays || 0 })
        fs.rm(input.filePath, { force: true }, () => {}) // best-effort cleanup, now that storage has read it
        // execStoreToStorage never throws (it records a per-destination ok:false
        // instead, so one bad destination doesn't hide another's successful key) —
        // surface any failure as a node error here so the run's status/retry/
        // failure-notification pipeline (and the calendar's "failed" marker) see
        // it. Preserve the full per-destination output first so a partial
        // success's upload key is still recoverable for Restore.
        entry.output = jsonPreview(output)
        const failed = output.uploaded.filter((u) => !u.ok)
        if (failed.length) throw new Error(`Upload failed for ${failed.length} of ${output.uploaded.length} destination(s): ${failed[0].error}`)
      } else {
        output = input
      }
      entry.output = jsonPreview(output)
      entry.ms = Date.now() - t0
      return output
    } catch (err) {
      entry.status = 'error'
      entry.error = err.message
      entry.ms = Date.now() - t0
      throw err
    }
  }

  // Walk the graph from `node`, returning the terminal output of its path.
  async function walk(node, input) {
    guard()
    // Switch: evaluate cases, follow only the matched branch.
    if (node.type === 'switch') {
      const t0 = Date.now()
      const entry = { nodeId: node.id, nodeType: 'switch', status: 'ok', ms: 0, output: undefined }
      log.push(entry)
      let handle = 'default'
      try {
        const cases = node.data?.cases || []
        for (let i = 0; i < cases.length; i++) {
          const { out } = runUserJs(`return (${cases[i].expr || 'false'})`, input)
          if (out) {
            handle = `case-${i}`
            break
          }
        }
        entry.output = jsonPreview({ matched: handle })
        entry.ms = Date.now() - t0
      } catch (err) {
        entry.status = 'error'
        entry.error = err.message
        throw err
      }
      let terminal = input
      for (const e of outgoing(node.id, handle)) {
        const child = nodes.get(e.target)
        if (child) terminal = await walk(child, input)
      }
      return terminal
    }
    // Loop: run the body branch per item, collect results, then continue.
    if (node.type === 'loop') {
      const t0 = Date.now()
      const entry = { nodeId: node.id, nodeType: 'loop', status: 'ok', ms: 0, output: undefined }
      log.push(entry)
      let items = input
      try {
        if (node.data?.itemsExpr?.trim()) items = runUserJs(`return (${node.data.itemsExpr})`, input).out
        if (!Array.isArray(items)) throw new Error('Loop input is not an array')
      } catch (err) {
        entry.status = 'error'
        entry.error = err.message
        throw err
      }
      const results = []
      const body = outgoing(node.id, 'body')
      for (let i = 0; i < items.length && i < MAX_ITER; i++) {
        for (const e of body) {
          const child = nodes.get(e.target)
          if (child) results.push(await walk(child, items[i]))
        }
      }
      entry.output = jsonPreview({ iterations: Math.min(items.length, MAX_ITER) })
      entry.ms = Date.now() - t0
      let terminal = results
      for (const e of outgoing(node.id, 'done')) {
        const child = nodes.get(e.target)
        if (child) terminal = await walk(child, results)
      }
      return terminal
    }
    // Leaf node → compute, then follow default output.
    const output = await evalLeaf(node, input)
    let terminal = output
    for (const e of outgoing(node.id, 'out')) {
      const child = nodes.get(e.target)
      if (child) terminal = await walk(child, output)
    }
    return terminal
  }

  try {
    const hasIncoming = new Set(edges.map((e) => e.target))
    const roots = (graph?.nodes || []).filter((n) => !hasIncoming.has(n.id))
    if (!roots.length) return { ok: false, log, error: 'No start node (every node has an incoming connection).' }
    let output
    for (const r of roots) output = await walk(r, initialInput)
    return { ok: true, log, output: jsonPreview(output, 8000) }
  } catch (err) {
    return { ok: false, log, error: err.message }
  }
}

// Run a workflow and persist the outcome to workflow_runs — shared by the
// manual "Run" route and the scheduler tick, so both count toward a workflow's
// run history (and, for the backup workflow, its monitoring calendar).
async function executeAndRecord(workflowId, connectionId, conn, graph, triggerKind, input = null) {
  const startedAt = Date.now()
  const result = await runWorkflow(conn, graph, input)
  meta
    .prepare(
      `INSERT INTO workflow_runs (id, workflow_id, connection_id, trigger_kind, status, log, error, started_at, finished_at, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      workflowId,
      connectionId,
      triggerKind,
      result.ok ? 'success' : 'failed',
      JSON.stringify(result.log || []),
      result.error || null,
      startedAt,
      Date.now(),
      startedAt
    )
  return result
}

// Next epoch-ms this frequency should fire, in UTC. Hourly: top of the next
// hour. Daily: the next occurrence of hourOfDay (today if not yet passed).
function computeNextRun(frequency, hourOfDay, from = Date.now()) {
  const d = new Date(from)
  if (frequency === 'hourly') {
    d.setUTCMinutes(0, 0, 0)
    d.setUTCHours(d.getUTCHours() + 1)
    return d.getTime()
  }
  d.setUTCHours(hourOfDay || 0, 0, 0, 0)
  if (d.getTime() <= from) d.setUTCDate(d.getUTCDate() + 1)
  return d.getTime()
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
      `SELECT w.id, w.name, w.created_at, w.settings, m.role
       FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = ? ORDER BY w.created_at`
    )
    .all(user.id)
  // Beta experiment flags + notification prefs ship in the list response (not
  // just the detail route) so nav-level gating and this settings panel don't
  // go stale after a save that only refreshes via listWorkspaces().
  res.json(
    rows.map((r) => {
      const settings = safeJson(r.settings)
      return { id: r.id, name: r.name, role: r.role, createdAt: r.created_at, experiments: settings.experiments || {}, notifications: settings.notifications || {} }
    })
  )
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
  const row = meta.prepare('SELECT settings FROM workspaces WHERE id = ?').get(req.params.id)
  const settings = safeJson(row?.settings)
  // Beta experiment flags — visible to every member (they gate what the whole
  // workspace sees, e.g. the S3/Backup nav item), toggleable by admins only
  // (enforced in the PUT route below).
  ws.experiments = settings.experiments || {}
  // Notification preferences (e.g. who to email on backup failure) — visible
  // to every member, toggleable by admins only (enforced in the PUT route).
  ws.notifications = settings.notifications || {}
  // Admins also get the (password-masked) SMTP config for the settings form.
  if (ws.role === 'admin') {
    const smtp = settings.smtp || {}
    ws.smtp = { host: smtp.host || '', port: smtp.port || '', secure: !!smtp.secure, user: smtp.user || '', from: smtp.from || '', hasPassword: !!smtp.pass }
    ws.smtpEnvFallback = !!process.env.SMTP_HOST
    // Non-secret env values, so the settings form can show what's actually in effect
    // when the workspace hasn't overridden it (password never leaves the server).
    if (ws.smtpEnvFallback) {
      ws.smtpEnvDefaults = {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || '587',
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER || '',
        from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
      }
    }
  }
  res.json(ws)
})

// Rename + SMTP settings + beta experiment flags (admin).
app.put('/api/workspaces/:id', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const row = meta.prepare('SELECT settings FROM workspaces WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Workspace not found' })
  const { name, smtp, experiments, notifications } = req.body || {}
  if (name?.trim()) meta.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name.trim(), req.params.id)
  if (smtp || experiments || notifications) {
    const settings = safeJson(row.settings)
    if (smtp) {
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
    }
    if (experiments) settings.experiments = { ...(settings.experiments || {}), ...experiments }
    if (notifications) {
      settings.notifications = { ...(settings.notifications || {}) }
      if (notifications.backupFailure) {
        settings.notifications.backupFailure = {
          enabled: !!notifications.backupFailure.enabled,
          memberIds: Array.isArray(notifications.backupFailure.memberIds) ? notifications.backupFailure.memberIds : [],
        }
      }
    }
    meta.prepare('UPDATE workspaces SET settings = ? WHERE id = ?').run(JSON.stringify(settings), req.params.id)
  }
  res.json({ ok: true })
})

// Send a test email using either the unsaved form values (body.smtp) or, if
// omitted, whatever is already saved/env-configured for this workspace.
app.post('/api/workspaces/:id/smtp/test', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const row = meta.prepare('SELECT settings FROM workspaces WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Workspace not found' })
  const { to, smtp: overrides } = req.body || {}
  let cfg
  if (overrides?.host) {
    let prev = {}
    try {
      prev = JSON.parse(row.settings || '{}').smtp || {}
    } catch {
      prev = {}
    }
    cfg = smtpConfig({
      settings: JSON.stringify({
        smtp: {
          host: overrides.host,
          port: overrides.port,
          secure: overrides.secure,
          user: overrides.user,
          from: overrides.from,
          pass: overrides.pass || prev.pass,
        },
      }),
    })
  } else {
    cfg = smtpConfig(row)
  }
  if (!cfg) return res.status(400).json({ error: 'No SMTP host configured.' })
  try {
    await sendMail(cfg, {
      to: to || user.username,
      subject: 'Tabletsgo test email',
      text: 'This is a test email from your Tabletsgo SMTP settings. If you received it, the configuration works.',
      html: '<p>This is a test email from your Tabletsgo SMTP settings.</p><p>If you received it, the configuration works.</p>',
    })
    res.json({ ok: true })
  } catch (err) {
    // "wrong version number" is OpenSSL-speak for "the TLS mode doesn't match
    // what the server expects on that port" — translate it, since the raw
    // error is meaningless to anyone who isn't reading OpenSSL source.
    const raw = err.message || 'Failed to send test email.'
    const message = /wrong version number/i.test(raw)
      ? "SSL/TLS handshake failed — the encryption mode probably doesn't match the port. Try switching between STARTTLS (587) and Implicit TLS/SSL (465)."
      : raw
    res.status(400).json({ error: message })
  }
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
      meta.prepare('DELETE FROM domains WHERE connection_id = ?').run(row.id)
      meta.prepare('DELETE FROM table_domains WHERE connection_id = ?').run(row.id)
      meta.prepare('DELETE FROM workflows WHERE connection_id = ?').run(row.id)
      meta.prepare('DELETE FROM dashboards WHERE connection_id = ?').run(row.id)
      meta.prepare('DELETE FROM folders WHERE connection_id = ?').run(row.id)
      meta.prepare('DELETE FROM query_history WHERE connection_id = ?').run(row.id)
      meta.prepare('DELETE FROM connection_access WHERE connection_id = ?').run(row.id)
    }
  }
  meta.prepare('DELETE FROM workspace_members WHERE workspace_id = ?').run(req.params.id)
  // Drop the workspace's teams (and their membership rows).
  meta.prepare('DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE workspace_id = ?)').run(req.params.id)
  meta.prepare('DELETE FROM teams WHERE workspace_id = ?').run(req.params.id)
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
  // Drop the removed user from this workspace's teams so they can't retain
  // team-granted connection access.
  meta
    .prepare(
      `DELETE FROM team_members WHERE user_id = ? AND team_id IN (SELECT id FROM teams WHERE workspace_id = ?)`
    )
    .run(req.params.userId, req.params.id)
  // Clean up a pending user that no longer belongs to any workspace.
  const left = meta.prepare('SELECT COUNT(*) c FROM workspace_members WHERE user_id = ?').get(req.params.userId).c
  const u = meta.prepare('SELECT status FROM users WHERE id = ?').get(req.params.userId)
  if (left === 0 && u?.status === 'pending') meta.prepare('DELETE FROM users WHERE id = ?').run(req.params.userId)
  res.json({ ok: true })
})

// ============================================================================
// Teams (workspace-scoped groups of members)
// ============================================================================

// List a workspace's teams with member counts (any member can view).
app.get('/api/workspaces/:id/teams', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (!memberRole(req.params.id, user.id)) return res.status(403).json({ error: 'Forbidden' })
  const rows = meta
    .prepare(
      `SELECT t.id, t.name, t.created_at,
              (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS memberCount
       FROM teams t WHERE t.workspace_id = ? ORDER BY t.created_at`
    )
    .all(req.params.id)
  res.json(rows.map((r) => ({ id: r.id, name: r.name, memberCount: r.memberCount, createdAt: r.created_at })))
})

// Create a team (admin).
app.post('/api/workspaces/:id/teams', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const name = (req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Team name is required.' })
  const id = randomUUID()
  const now = Date.now()
  meta.prepare('INSERT INTO teams (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)').run(id, req.params.id, name, now)
  res.json({ id, name, memberCount: 0, createdAt: now })
})

// Rename a team (admin).
app.put('/api/workspaces/:id/teams/:teamId', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const team = meta.prepare('SELECT id FROM teams WHERE id = ? AND workspace_id = ?').get(req.params.teamId, req.params.id)
  if (!team) return res.status(404).json({ error: 'Team not found' })
  const name = (req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Team name is required.' })
  meta.prepare('UPDATE teams SET name = ? WHERE id = ?').run(name, req.params.teamId)
  res.json({ ok: true })
})

// Delete a team (admin) — cascades its members and any connection assignments.
app.delete('/api/workspaces/:id/teams/:teamId', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const team = meta.prepare('SELECT id FROM teams WHERE id = ? AND workspace_id = ?').get(req.params.teamId, req.params.id)
  if (!team) return res.status(404).json({ error: 'Team not found' })
  meta.prepare('DELETE FROM team_members WHERE team_id = ?').run(req.params.teamId)
  meta.prepare("DELETE FROM connection_access WHERE principal_type = 'team' AND principal_id = ?").run(req.params.teamId)
  meta.prepare('DELETE FROM teams WHERE id = ?').run(req.params.teamId)
  res.json({ ok: true })
})

// List a team's members (any workspace member can view).
app.get('/api/workspaces/:id/teams/:teamId/members', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (!memberRole(req.params.id, user.id)) return res.status(403).json({ error: 'Forbidden' })
  const team = meta.prepare('SELECT id FROM teams WHERE id = ? AND workspace_id = ?').get(req.params.teamId, req.params.id)
  if (!team) return res.status(404).json({ error: 'Team not found' })
  const rows = meta
    .prepare(
      `SELECT u.id AS userId, u.username AS email, u.name
       FROM team_members tm JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = ? ORDER BY tm.created_at`
    )
    .all(req.params.teamId)
  res.json(rows)
})

// Add a member to a team (admin). The user must belong to the workspace.
app.post('/api/workspaces/:id/teams/:teamId/members', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const team = meta.prepare('SELECT id FROM teams WHERE id = ? AND workspace_id = ?').get(req.params.teamId, req.params.id)
  if (!team) return res.status(404).json({ error: 'Team not found' })
  const userId = req.body?.userId
  if (!userId) return res.status(400).json({ error: 'userId is required.' })
  if (!memberRole(req.params.id, userId)) return res.status(400).json({ error: 'That person is not a workspace member.' })
  meta
    .prepare('INSERT OR IGNORE INTO team_members (id, team_id, user_id, created_at) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), req.params.teamId, userId, Date.now())
  res.json({ ok: true })
})

// Remove a member from a team (admin).
app.delete('/api/workspaces/:id/teams/:teamId/members/:userId', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const team = meta.prepare('SELECT id FROM teams WHERE id = ? AND workspace_id = ?').get(req.params.teamId, req.params.id)
  if (!team) return res.status(404).json({ error: 'Team not found' })
  meta.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(req.params.teamId, req.params.userId)
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
  res.json(listConnections().filter((c) => c.workspaceId === workspaceId && userCanAccessConnection(c, user.id)))
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
  // Default the owner to the creating user (unless one was explicitly provided).
  const conn = { ...req.body, id: randomUUID(), workspaceId, ownerId: req.body.ownerId || user.id }
  saveConnection(conn)
  res.json(getConnection(conn.id))
})

// ---- Storage destinations (S3-compatible, workspace-scoped) ----
app.get('/api/storages', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const workspaceId = req.query.workspace
  if (!workspaceId) return res.json([])
  if (!memberRole(workspaceId, user.id)) return res.status(403).json({ error: 'Forbidden' })
  res.json(listStorageRows(workspaceId))
})

app.post('/api/storages', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const { workspaceId, name, endpoint, region, bucket, pathPrefix, forcePathStyle, accessKeyId, secretAccessKey, sessionToken } = req.body || {}
  if (!workspaceId || !memberRole(workspaceId, user.id)) return res.status(403).json({ error: 'Forbidden' })
  if (!name?.trim() || !bucket?.trim()) return res.status(400).json({ error: 'A name and bucket are required' })
  const now = Date.now()
  const entry = {
    id: randomUUID(),
    workspace_id: workspaceId,
    name: name.trim(),
    endpoint: endpoint?.trim() || null,
    region: region?.trim() || null,
    bucket: bucket.trim(),
    path_prefix: pathPrefix?.trim() || null,
    force_path_style: forcePathStyle ? 1 : 0,
    credentials: encryptSecret(JSON.stringify({ accessKeyId, secretAccessKey, sessionToken }), STORAGE_CRED_KEY),
  }
  meta
    .prepare(
      `INSERT INTO storage_destinations
       (id, workspace_id, name, endpoint, region, bucket, path_prefix, force_path_style, credentials, created_at, updated_at)
       VALUES (@id, @workspace_id, @name, @endpoint, @region, @bucket, @path_prefix, @force_path_style, @credentials, @now, @now)`
    )
    .run({ ...entry, now })
  res.json(getStorage(entry.id))
})

// Guard every per-storage route: caller must be a member of the destination's workspace.
app.use('/api/storages/:sid', (req, res, next) => {
  const user = requireAuth(req, res)
  if (!user) return
  const dest = getStorage(req.params.sid)
  if (!dest) return res.status(404).json({ error: 'Storage destination not found' })
  if (!memberRole(dest.workspaceId, user.id)) return res.status(403).json({ error: 'Forbidden' })
  next()
})

app.put('/api/storages/:sid', (req, res) => {
  const existing = getStorage(req.params.sid)
  const body = req.body || {}
  const merged = { ...existing, ...body }
  if (!merged.name?.trim() || !merged.bucket?.trim()) return res.status(400).json({ error: 'A name and bucket are required' })
  meta
    .prepare(
      `UPDATE storage_destinations
       SET name = ?, endpoint = ?, region = ?, bucket = ?, path_prefix = ?, force_path_style = ?, credentials = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      merged.name.trim(),
      merged.endpoint?.trim() || null,
      merged.region?.trim() || null,
      merged.bucket.trim(),
      merged.pathPrefix?.trim() || null,
      merged.forcePathStyle ? 1 : 0,
      encryptSecret(
        JSON.stringify({ accessKeyId: merged.accessKeyId, secretAccessKey: merged.secretAccessKey, sessionToken: merged.sessionToken }),
        STORAGE_CRED_KEY
      ),
      Date.now(),
      req.params.sid
    )
  s3Clients.delete(req.params.sid) // credentials/endpoint may have changed
  res.json(getStorage(req.params.sid))
})

app.delete('/api/storages/:sid', (req, res) => {
  // Refuse if any workflow's graph still references this destination from a
  // `storage` node — deleting it out from under a scheduled backup would fail
  // silently at run time otherwise.
  const inUse = meta
    .prepare(`SELECT graph FROM workflows`)
    .all()
    .some((w) => {
      const graph = safeJson(w.graph)
      return (graph?.nodes || []).some((n) => n.type === 'storage' && (n.data?.destinationIds || []).includes(req.params.sid))
    })
  if (inUse) return res.status(409).json({ error: 'This storage destination is used by a workflow and cannot be deleted.' })
  meta.prepare('DELETE FROM storage_destinations WHERE id = ?').run(req.params.sid)
  s3Clients.delete(req.params.sid)
  res.json({ ok: true })
})

app.post('/api/storages/:sid/test', async (req, res) => {
  const dest = getStorage(req.params.sid)
  try {
    await getS3Client(dest).send(new HeadBucketCommand({ Bucket: dest.bucket }))
    res.json({ ok: true, message: `Connected! Bucket "${dest.bucket}" is reachable.` })
  } catch (error) {
    res.json({ ok: false, message: describeError(error) })
  }
})

// Guard every per-connection route: caller must be a member of the connection's
// workspace. One mount covers PUT/DELETE /:id and all /:id/* data routes.
app.use('/api/connections/:id', (req, res, next) => {
  const user = requireAuth(req, res)
  if (!user) return
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  if (conn.workspaceId && !userCanAccessConnection(conn, user.id)) return res.status(403).json({ error: 'Forbidden' })
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
  meta.prepare('DELETE FROM folders WHERE connection_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM domains WHERE connection_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM table_domains WHERE connection_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM workflows WHERE connection_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM workflow_runs WHERE connection_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM dashboards WHERE connection_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM query_history WHERE connection_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM connection_access WHERE connection_id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ---- Connection access (which teams/members may see this connection) ----
// Any user who passes the access guard can read the assignment; only a
// workspace admin can change it.
app.get('/api/connections/:id/access', (req, res) => {
  res.json(connectionAccess(req.params.id))
})

app.put('/api/connections/:id/access', (req, res) => {
  const user = authUser(req)
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  if (conn.workspaceId && memberRole(conn.workspaceId, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const teams = Array.isArray(req.body?.teams) ? req.body.teams : []
  const users = Array.isArray(req.body?.users) ? req.body.users : []
  setConnectionAccess(req.params.id, { teams, users })
  res.json(connectionAccess(req.params.id))
})

// ---- Saved queries (per connection) ----
app.get('/api/connections/:id/saved', (req, res) => {
  const rows = meta
    .prepare('SELECT id, name, sql, kind, folder_id, ts FROM saved_queries WHERE connection_id = ? ORDER BY ts DESC')
    .all(req.params.id)
  res.json(rows.map((r) => ({ ...r, kind: r.kind || 'query', folderId: r.folder_id || null })))
})

// ---- Folders (per connection, polymorphic by `type`) ----
// One tree per (connection, type): 'query' groups saved queries, 'dashboard'
// groups dashboards. Each item points back via its own `folder_id` column, and
// `parent_id` builds the tree (NULL = root). Nesting caps are per type (queries
// uncapped for back-compat; dashboards capped at 3) and enforced here. Adding a
// new folderable resource = one entry in FOLDER_TYPES + a `folder_id` column.
const FOLDER_TYPES = {
  query: { itemTable: 'saved_queries', maxDepth: Infinity },
  dashboard: { itemTable: 'dashboards', maxDepth: 3 },
}
// Coerce an untrusted `type` to a known one (defaults to 'query' for older
// clients that predate the `type` param). Guards the itemTable interpolation.
const folderTypeOf = (t) => (t && FOLDER_TYPES[t] ? t : 'query')

// parent_id lookup for one connection's folders of a given type.
function folderParents(connectionId, type) {
  return new Map(
    meta
      .prepare('SELECT id, parent_id FROM folders WHERE connection_id = ? AND type = ?')
      .all(connectionId, type)
      .map((r) => [r.id, r.parent_id || null])
  )
}
// Levels from the root down to `folderId` (root folder = 1, NULL = 0).
function folderDepth(connectionId, type, folderId, parentOf = folderParents(connectionId, type)) {
  let depth = 0
  let cur = folderId
  const seen = new Set()
  while (cur && !seen.has(cur)) {
    depth++
    seen.add(cur)
    cur = parentOf.get(cur) || null
  }
  return depth
}
// Height of the subtree rooted at `folderId` (the folder itself = 1).
function folderHeight(connectionId, type, folderId) {
  const children = new Map()
  for (const r of meta.prepare('SELECT id, parent_id FROM folders WHERE connection_id = ? AND type = ?').all(connectionId, type)) {
    const p = r.parent_id || null
    if (!children.has(p)) children.set(p, [])
    children.get(p).push(r.id)
  }
  const heightFrom = (fid) => 1 + (children.get(fid) || []).reduce((m, c) => Math.max(m, heightFrom(c)), 0)
  return heightFrom(folderId)
}
// True if `folderId` is `candidateAncestor` or nested somewhere beneath it —
// used to reject reparenting a folder into its own subtree (a cycle).
function folderHasAncestor(connectionId, type, folderId, candidateAncestor, parentOf = folderParents(connectionId, type)) {
  let cur = folderId
  const seen = new Set()
  while (cur && !seen.has(cur)) {
    if (cur === candidateAncestor) return true
    seen.add(cur)
    cur = parentOf.get(cur) || null
  }
  return false
}

app.get('/api/connections/:id/folders', (req, res) => {
  const type = folderTypeOf(req.query.type)
  const rows = meta
    .prepare('SELECT id, name, parent_id, ts FROM folders WHERE connection_id = ? AND type = ? ORDER BY ts ASC')
    .all(req.params.id, type)
  res.json(rows.map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id || null, type, ts: r.ts })))
})

app.post('/api/connections/:id/folders', (req, res) => {
  const { name, parentId } = req.body || {}
  const type = folderTypeOf(req.body?.type)
  if (!name?.trim()) return res.status(400).json({ error: 'A folder name is required' })
  if (parentId) {
    const parent = meta
      .prepare('SELECT id FROM folders WHERE id = ? AND connection_id = ? AND type = ?')
      .get(parentId, req.params.id, type)
    if (!parent) return res.status(400).json({ error: 'Parent folder not found' })
    if (folderDepth(req.params.id, type, parentId) >= FOLDER_TYPES[type].maxDepth)
      return res.status(400).json({ error: `Folders can only nest ${FOLDER_TYPES[type].maxDepth} levels deep` })
  }
  const entry = { id: randomUUID(), name: name.trim(), parentId: parentId || null, type, ts: Date.now() }
  meta
    .prepare('INSERT INTO folders (id, connection_id, type, name, parent_id, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .run(entry.id, req.params.id, entry.type, entry.name, entry.parentId, entry.ts)
  res.json(entry)
})

app.put('/api/connections/:id/folders/:fid', (req, res) => {
  const body = req.body || {}
  const folder = meta
    .prepare('SELECT type FROM folders WHERE id = ? AND connection_id = ?')
    .get(req.params.fid, req.params.id)
  if (!folder) return res.status(404).json({ error: 'Not found' })
  const type = folderTypeOf(folder.type)
  const { name } = body
  const sets = []
  const vals = []
  if (name != null) {
    if (!name.trim()) return res.status(400).json({ error: 'A folder name is required' })
    sets.push('name = ?')
    vals.push(name.trim())
  }
  // parentId is explicitly settable (null moves the folder to the root).
  if ('parentId' in body) {
    const parentId = body.parentId || null
    if (parentId) {
      if (parentId === req.params.fid) return res.status(400).json({ error: "A folder can't be its own parent" })
      const parent = meta
        .prepare('SELECT id FROM folders WHERE id = ? AND connection_id = ? AND type = ?')
        .get(parentId, req.params.id, type)
      if (!parent) return res.status(400).json({ error: 'Parent folder not found' })
      if (folderHasAncestor(req.params.id, type, parentId, req.params.fid))
        return res.status(400).json({ error: "Can't move a folder into its own subfolder" })
      // The moved subtree's deepest leaf must still fit within the depth cap.
      const newDepth = folderDepth(req.params.id, type, parentId) + folderHeight(req.params.id, type, req.params.fid)
      if (newDepth > FOLDER_TYPES[type].maxDepth)
        return res.status(400).json({ error: `Folders can only nest ${FOLDER_TYPES[type].maxDepth} levels deep` })
    }
    sets.push('parent_id = ?')
    vals.push(parentId)
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  const r = meta
    .prepare(`UPDATE folders SET ${sets.join(', ')} WHERE id = ? AND connection_id = ?`)
    .run(...vals, req.params.fid, req.params.id)
  if (!r.changes) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

app.delete('/api/connections/:id/folders/:fid', (req, res) => {
  // Reparent the folder's contents up one level (to its own parent) rather than
  // deleting them: child folders and items move to the deleted folder's parent.
  const row = meta
    .prepare('SELECT type, parent_id FROM folders WHERE id = ? AND connection_id = ?')
    .get(req.params.fid, req.params.id)
  const type = folderTypeOf(row?.type)
  const parentId = row?.parent_id || null
  meta
    .prepare('UPDATE folders SET parent_id = ? WHERE parent_id = ? AND connection_id = ?')
    .run(parentId, req.params.fid, req.params.id)
  // itemTable comes from the FOLDER_TYPES allowlist (via folderTypeOf) — safe to interpolate.
  meta
    .prepare(`UPDATE ${FOLDER_TYPES[type].itemTable} SET folder_id = ? WHERE folder_id = ? AND connection_id = ?`)
    .run(parentId, req.params.fid, req.params.id)
  meta.prepare('DELETE FROM folders WHERE id = ? AND connection_id = ?').run(req.params.fid, req.params.id)
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

// ---- Domains (per connection) ----
// A domain is a named, colored entity that groups tables; each table belongs to
// at most one domain. The shape is database-agnostic (table names are plain
// strings) so it works for any dialect the connection targets. Each domain
// carries the list of table names it currently groups.
const domainWithTables = (connectionId, domain) => ({
  id: domain.id,
  name: domain.name,
  color: domain.color || null,
  ts: domain.ts,
  tables: meta
    .prepare('SELECT table_name FROM table_domains WHERE connection_id = ? AND domain_id = ? ORDER BY table_name ASC')
    .all(connectionId, domain.id)
    .map((r) => r.table_name),
})

app.get('/api/connections/:id/domains', (req, res) => {
  const rows = meta
    .prepare('SELECT id, name, color, ts FROM domains WHERE connection_id = ? ORDER BY ts ASC')
    .all(req.params.id)
  res.json(rows.map((d) => domainWithTables(req.params.id, d)))
})

app.post('/api/connections/:id/domains', (req, res) => {
  const { name, color } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'A domain name is required' })
  const entry = { id: randomUUID(), name: name.trim(), color: color || null, ts: Date.now() }
  meta
    .prepare('INSERT INTO domains (id, connection_id, name, color, ts) VALUES (?, ?, ?, ?, ?)')
    .run(entry.id, req.params.id, entry.name, entry.color, entry.ts)
  res.json(domainWithTables(req.params.id, entry))
})

app.put('/api/connections/:id/domains/:domainId', (req, res) => {
  const body = req.body || {}
  const sets = []
  const vals = []
  if (body.name != null) {
    if (!body.name.trim()) return res.status(400).json({ error: 'A domain name is required' })
    sets.push('name = ?')
    vals.push(body.name.trim())
  }
  if ('color' in body) {
    sets.push('color = ?')
    vals.push(body.color || null)
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  const r = meta
    .prepare(`UPDATE domains SET ${sets.join(', ')} WHERE id = ? AND connection_id = ?`)
    .run(...vals, req.params.domainId, req.params.id)
  if (!r.changes) return res.status(404).json({ error: 'Not found' })
  const domain = meta.prepare('SELECT id, name, color, ts FROM domains WHERE id = ?').get(req.params.domainId)
  res.json(domainWithTables(req.params.id, domain))
})

app.delete('/api/connections/:id/domains/:domainId', (req, res) => {
  meta.prepare('DELETE FROM table_domains WHERE domain_id = ? AND connection_id = ?').run(req.params.domainId, req.params.id)
  meta.prepare('DELETE FROM domains WHERE id = ? AND connection_id = ?').run(req.params.domainId, req.params.id)
  res.json({ ok: true })
})

// Set (or clear) a table's domain. `domainId: null` removes the table from any
// domain; otherwise the table is reassigned to that single domain (upsert).
app.put('/api/connections/:id/tables/:table/domain', (req, res) => {
  const domainId = req.body?.domainId ?? null
  const table = req.params.table
  if (domainId === null) {
    meta.prepare('DELETE FROM table_domains WHERE connection_id = ? AND table_name = ?').run(req.params.id, table)
    return res.json({ ok: true })
  }
  const domain = meta.prepare('SELECT id FROM domains WHERE id = ? AND connection_id = ?').get(domainId, req.params.id)
  if (!domain) return res.status(404).json({ error: 'Domain not found' })
  meta
    .prepare(
      `INSERT INTO table_domains (id, connection_id, table_name, domain_id, ts) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(connection_id, table_name) DO UPDATE SET domain_id = excluded.domain_id, ts = excluded.ts`
    )
    .run(randomUUID(), req.params.id, table, domainId, Date.now())
  res.json({ ok: true })
})

// ---- Workflows (per connection) ----
// A workflow can be marked `protected` (undeletable) — `DELETE` 409s on it,
// everything else behaves like a normal workflow. Nothing currently sets this
// automatically (backups are a separate system — see the Backup section below).
app.get('/api/connections/:id/workflows', (req, res) => {
  const rows = meta
    .prepare('SELECT id, name, ts, protected, schedule_enabled FROM workflows WHERE connection_id = ? ORDER BY ts DESC')
    .all(req.params.id)
  res.json(rows.map((r) => ({ id: r.id, name: r.name, ts: r.ts, protected: !!r.protected, scheduleEnabled: !!r.schedule_enabled })))
})

app.post('/api/connections/:id/workflows', (req, res) => {
  const { name } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'A workflow name is required' })
  const entry = { id: randomUUID(), name: name.trim(), graph: { nodes: [], edges: [] }, ts: Date.now() }
  meta
    .prepare('INSERT INTO workflows (id, connection_id, name, graph, ts) VALUES (?, ?, ?, ?, ?)')
    .run(entry.id, req.params.id, entry.name, JSON.stringify(entry.graph), entry.ts)
  res.json({ ...entry, protected: false, scheduleEnabled: false })
})

app.get('/api/connections/:id/workflows/:wid', (req, res) => {
  const row = meta
    .prepare('SELECT id, name, graph, protected, schedule_enabled FROM workflows WHERE id = ? AND connection_id = ?')
    .get(req.params.wid, req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json({
    id: row.id,
    name: row.name,
    graph: safeJson(row.graph),
    protected: !!row.protected,
    scheduleEnabled: !!row.schedule_enabled,
  })
})

app.put('/api/connections/:id/workflows/:wid', (req, res) => {
  const body = req.body || {}
  const existing = meta.prepare('SELECT graph, schedule_enabled FROM workflows WHERE id = ? AND connection_id = ?').get(req.params.wid, req.params.id)
  if (!existing) return res.status(404).json({ error: 'Not found' })
  const sets = []
  const vals = []
  if (body.name != null) {
    if (!body.name.trim()) return res.status(400).json({ error: 'A name is required' })
    sets.push('name = ?')
    vals.push(body.name.trim())
  }
  if (body.graph != null) {
    sets.push('graph = ?')
    vals.push(JSON.stringify(body.graph))
  }
  if (body.scheduleEnabled != null) {
    sets.push('schedule_enabled = ?')
    vals.push(body.scheduleEnabled ? 1 : 0)
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  // Recompute next_run_at whenever the graph or the enabled flag changes —
  // whichever the request just posted wins over what's already stored.
  if (body.graph != null || body.scheduleEnabled != null) {
    const graph = body.graph != null ? body.graph : safeJson(existing.graph)
    const enabled = body.scheduleEnabled != null ? !!body.scheduleEnabled : !!existing.schedule_enabled
    const schedNode = (graph?.nodes || []).find((n) => n.type === 'schedule')
    const nextRun =
      enabled && schedNode?.data?.frequency && schedNode.data.frequency !== 'manual'
        ? computeNextRun(schedNode.data.frequency, schedNode.data.hourOfDay)
        : null
    sets.push('next_run_at = ?')
    vals.push(nextRun)
  }
  const r = meta
    .prepare(`UPDATE workflows SET ${sets.join(', ')} WHERE id = ? AND connection_id = ?`)
    .run(...vals, req.params.wid, req.params.id)
  if (!r.changes) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

app.delete('/api/connections/:id/workflows/:wid', (req, res) => {
  const row = meta.prepare('SELECT protected FROM workflows WHERE id = ? AND connection_id = ?').get(req.params.wid, req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (row.protected) return res.status(409).json({ error: 'This workflow is protected and cannot be deleted.' })
  meta.prepare('DELETE FROM workflows WHERE id = ? AND connection_id = ?').run(req.params.wid, req.params.id)
  res.json({ ok: true })
})

// ---- Dashboards (per connection) ----
// A dashboard is a name + one JSON config: { variables: [...], widgets: [...] }.
// The config shape is owned by the frontend (src/features/dashboard/types.ts);
// the server just stores and returns it, so it stays database-agnostic.
// Dashboards can live in a folder (folders table, type='dashboard').

app.get('/api/connections/:id/dashboards', (req, res) => {
  const rows = meta
    .prepare('SELECT id, name, folder_id, ts FROM dashboards WHERE connection_id = ? ORDER BY ts DESC')
    .all(req.params.id)
  res.json(rows.map((r) => ({ id: r.id, name: r.name, folderId: r.folder_id || null, ts: r.ts })))
})

app.post('/api/connections/:id/dashboards', (req, res) => {
  const { name, config, folderId } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'A dashboard name is required' })
  if (folderId) {
    const parent = meta
      .prepare("SELECT id FROM folders WHERE id = ? AND connection_id = ? AND type = 'dashboard'")
      .get(folderId, req.params.id)
    if (!parent) return res.status(400).json({ error: 'Folder not found' })
  }
  const entry = {
    id: randomUUID(),
    name: name.trim(),
    config: config && typeof config === 'object' ? config : { variables: [], widgets: [] },
    folderId: folderId || null,
    ts: Date.now(),
  }
  meta
    .prepare('INSERT INTO dashboards (id, connection_id, name, config, folder_id, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .run(entry.id, req.params.id, entry.name, JSON.stringify(entry.config), entry.folderId, entry.ts)
  res.json(entry)
})

app.get('/api/connections/:id/dashboards/:did', (req, res) => {
  const row = meta
    .prepare('SELECT id, name, config, ts FROM dashboards WHERE id = ? AND connection_id = ?')
    .get(req.params.did, req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json({ id: row.id, name: row.name, ts: row.ts, config: safeJson(row.config) || { variables: [], widgets: [] } })
})

app.put('/api/connections/:id/dashboards/:did', (req, res) => {
  const body = req.body || {}
  const sets = []
  const vals = []
  if (body.name != null) {
    if (!body.name.trim()) return res.status(400).json({ error: 'A name is required' })
    sets.push('name = ?')
    vals.push(body.name.trim())
  }
  if (body.config != null) {
    if (typeof body.config !== 'object') return res.status(400).json({ error: 'config must be an object' })
    sets.push('config = ?')
    vals.push(JSON.stringify(body.config))
  }
  // folderId is explicitly settable (null moves the dashboard back to the root).
  if ('folderId' in body) {
    const folderId = body.folderId || null
    if (folderId) {
      const parent = meta
        .prepare("SELECT id FROM folders WHERE id = ? AND connection_id = ? AND type = 'dashboard'")
        .get(folderId, req.params.id)
      if (!parent) return res.status(400).json({ error: 'Folder not found' })
    }
    sets.push('folder_id = ?')
    vals.push(folderId)
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  const r = meta
    .prepare(`UPDATE dashboards SET ${sets.join(', ')} WHERE id = ? AND connection_id = ?`)
    .run(...vals, req.params.did, req.params.id)
  if (!r.changes) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

app.delete('/api/connections/:id/dashboards/:did', (req, res) => {
  const r = meta.prepare('DELETE FROM dashboards WHERE id = ? AND connection_id = ?').run(req.params.did, req.params.id)
  if (!r.changes) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

// Run a workflow — executes the posted graph (unsaved edits) or the stored
// one, and records the outcome in workflow_runs.
app.post('/api/connections/:id/workflows/:wid/run', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  let graph = req.body?.graph
  if (!graph) {
    const row = meta.prepare('SELECT graph FROM workflows WHERE id = ? AND connection_id = ?').get(req.params.wid, req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    graph = safeJson(row.graph)
  }
  // `trigger` distinguishes dashboard row-action runs in the workflow_runs
  // audit trail; anything unrecognized falls back to 'manual'.
  const trigger = req.body?.trigger === 'dashboard' ? 'dashboard' : 'manual'
  const result = await executeAndRecord(req.params.wid, req.params.id, conn, graph, trigger, req.body?.input ?? null)
  res.json(result)
})

// ---- Backup (standalone system: own schedule + run history, independent of
// the generic workflow engine — reuses execExportSql/execStoreToStorage) ----
const rowToBackupSchedule = (row) =>
  row && {
    connectionId: row.connection_id,
    frequency: row.frequency,
    hourOfDay: row.hour_of_day ?? 0,
    destinationIds: safeJson(row.destination_ids) || [],
    retryLimit: row.retry_limit || 0,
    retryDelaySec: row.retry_delay_sec || 60,
    retentionDays: row.retention_days || 0,
    encrypt: !!row.encrypt,
    enabled: !!row.enabled,
  }
const getBackupScheduleRow = (connectionId) => meta.prepare('SELECT * FROM backup_schedules WHERE connection_id = ?').get(connectionId)

// Runs export → store once, records the outcome in backup_runs. Shared by
// manual "Run now" and the scheduler (see runBackupWithRetries below).
async function runBackupOnce(scheduleRow, conn, triggerKind) {
  const startedAt = Date.now()
  let status = 'success'
  let error = null
  let uploads = []
  let exportOutput = null
  try {
    exportOutput = await execExportSql(conn)
    // No S3 destination configured ⇒ default to the local server disk.
    const configured = safeJson(scheduleRow.destination_ids) || []
    const destinationIds = configured.length ? configured : [LOCAL_STORAGE_ID]
    const storeOutput = await execStoreToStorage(conn, exportOutput, destinationIds, {
      encrypt: !!scheduleRow.encrypt,
      retentionDays: scheduleRow.retention_days || 0,
    })
    uploads = storeOutput.uploaded
    const failed = uploads.filter((u) => !u.ok)
    if (failed.length) {
      status = 'failed'
      error = `Upload failed for ${failed.length} of ${uploads.length} destination(s): ${failed[0].error}`
    }
  } catch (err) {
    status = 'failed'
    error = describeError(err)
  } finally {
    if (exportOutput?.filePath) fs.rm(exportOutput.filePath, { force: true }, () => {})
  }
  const finishedAt = Date.now()
  const id = randomUUID()
  meta
    .prepare(
      `INSERT INTO backup_runs (id, connection_id, schedule_id, trigger_kind, status, error, uploads, started_at, finished_at, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, conn.id, scheduleRow.id, triggerKind, status, error, JSON.stringify(uploads), startedAt, finishedAt, startedAt)
  return { ok: status === 'success', error, uploads }
}

// Scheduled run, retrying up to scheduleRow.retry_limit times (with
// retry_delay_sec between attempts) if it fails. Notifies the workspace on a
// final failure (see notifyBackupFailure).
async function runBackupWithRetries(scheduleRow, conn) {
  let result = await runBackupOnce(scheduleRow, conn, 'schedule')
  let attempt = 0
  while (!result.ok && attempt < (scheduleRow.retry_limit || 0)) {
    await sleep((scheduleRow.retry_delay_sec || 60) * 1000)
    attempt++
    result = await runBackupOnce(scheduleRow, conn, 'retry')
  }
  if (!result.ok) await notifyBackupFailure(conn, result)
}

async function runDueBackups() {
  const due = meta.prepare('SELECT * FROM backup_schedules WHERE enabled = 1 AND next_run_at <= ?').all(Date.now())
  for (const schedule of due) {
    meta.prepare('UPDATE backup_schedules SET next_run_at = ? WHERE id = ?').run(computeNextRun(schedule.frequency, schedule.hour_of_day), schedule.id)
    const conn = getConnection(schedule.connection_id)
    if (!conn) continue
    runBackupWithRetries(schedule, conn).catch((e) => console.error(`Scheduled backup failed for connection ${schedule.connection_id}:`, e.message))
  }
}

function validateScheduleBody(conn, destinationIds, frequency) {
  if (!['hourly', 'daily'].includes(frequency)) return 'Frequency must be hourly or daily'
  if (!Array.isArray(destinationIds)) return 'destinationIds must be an array'
  // An empty list is allowed: the backup falls back to the local server disk
  // (see runBackupOnce). The reserved 'local' id is always valid; every other
  // id must be a real S3 destination in this connection's workspace.
  for (const did of destinationIds) {
    if (did === LOCAL_STORAGE_ID) continue
    if (getStorage(did)?.workspaceId !== conn.workspaceId) return 'One or more storage destinations are invalid'
  }
  return null
}

// Current backup schedule for this connection (null if none has been created yet).
app.get('/api/connections/:id/backup/schedule', (req, res) => {
  res.json({ schedule: rowToBackupSchedule(getBackupScheduleRow(req.params.id)) })
})

app.post('/api/connections/:id/backup/schedule', (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  if (!['sqlite', 'postgresql'].includes(conn.type)) {
    return res.status(400).json({ error: `Backups are not supported for connection type: ${conn.type}` })
  }
  if (getBackupScheduleRow(req.params.id)) return res.status(409).json({ error: 'This connection already has a backup schedule.' })
  const { frequency, hourOfDay, destinationIds, retryLimit, retryDelaySec, retentionDays, encrypt, enabled } = req.body || {}
  const err = validateScheduleBody(conn, destinationIds, frequency)
  if (err) return res.status(400).json({ error: err })

  const id = randomUUID()
  const now = Date.now()
  const isEnabled = enabled !== false
  meta
    .prepare(
      `INSERT INTO backup_schedules
       (id, connection_id, frequency, hour_of_day, destination_ids, retry_limit, retry_delay_sec, retention_days, encrypt, enabled, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      req.params.id,
      frequency,
      hourOfDay ?? 0,
      JSON.stringify(destinationIds),
      Math.max(0, Math.min(5, parseInt(retryLimit) || 0)),
      Math.max(1, parseInt(retryDelaySec) || 60),
      Math.max(0, parseInt(retentionDays) || 0),
      encrypt ? 1 : 0,
      isEnabled ? 1 : 0,
      isEnabled ? computeNextRun(frequency, hourOfDay ?? 0) : null,
      now,
      now
    )
  res.json({ schedule: rowToBackupSchedule(getBackupScheduleRow(req.params.id)) })
})

// Update any subset of the schedule's fields (also how Active/Paused toggles
// via a lightweight `{ enabled }` body).
app.put('/api/connections/:id/backup/schedule', (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  const row = getBackupScheduleRow(req.params.id)
  if (!row) return res.status(404).json({ error: 'No backup schedule exists for this connection.' })
  const body = req.body || {}
  const frequency = body.frequency ?? row.frequency
  const hourOfDay = body.hourOfDay ?? row.hour_of_day ?? 0
  const destinationIds = body.destinationIds ?? safeJson(row.destination_ids) ?? []
  const err = validateScheduleBody(conn, destinationIds, frequency)
  if (err) return res.status(400).json({ error: err })
  const retryLimit = body.retryLimit != null ? Math.max(0, Math.min(5, parseInt(body.retryLimit) || 0)) : row.retry_limit
  const retryDelaySec = body.retryDelaySec != null ? Math.max(1, parseInt(body.retryDelaySec) || 60) : row.retry_delay_sec
  const retentionDays = body.retentionDays != null ? Math.max(0, parseInt(body.retentionDays) || 0) : row.retention_days
  const encrypt = body.encrypt != null ? !!body.encrypt : !!row.encrypt
  const enabled = body.enabled != null ? !!body.enabled : !!row.enabled

  meta
    .prepare(
      `UPDATE backup_schedules SET frequency = ?, hour_of_day = ?, destination_ids = ?, retry_limit = ?, retry_delay_sec = ?,
       retention_days = ?, encrypt = ?, enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      frequency,
      hourOfDay,
      JSON.stringify(destinationIds),
      retryLimit,
      retryDelaySec,
      retentionDays,
      encrypt ? 1 : 0,
      enabled ? 1 : 0,
      enabled ? computeNextRun(frequency, hourOfDay) : null,
      Date.now(),
      row.id
    )
  res.json({ schedule: rowToBackupSchedule(getBackupScheduleRow(req.params.id)) })
})

// Run the connection's backup schedule immediately (no retry — same semantics
// as today's "Run now").
app.post('/api/connections/:id/backup/run', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  const row = getBackupScheduleRow(req.params.id)
  if (!row) return res.status(404).json({ error: 'No backup schedule exists for this connection.' })
  res.json(await runBackupOnce(row, conn, 'manual'))
})

// Per-day run counts — feeds the GitHub-style calendar.
app.get('/api/connections/:id/backup/calendar', (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 365, 366)
  const from = Date.now() - days * 86400000
  const rows = meta
    .prepare(
      `SELECT date(started_at / 1000, 'unixepoch') AS day, COUNT(*) AS runs,
              SUM(status = 'success') AS success, SUM(status = 'failed') AS failed
       FROM backup_runs WHERE connection_id = ? AND started_at >= ? GROUP BY day ORDER BY day`
    )
    .all(req.params.id, from)
  res.json({ days: rows })
})

// Paginated backup runs, with the uploaded-artifact info the version list
// needs. Optional `date=YYYY-MM-DD` filters to one day (heatmap click).
app.get('/api/connections/:id/backup/runs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 200)
  const offset = Math.max(0, parseInt(req.query.offset) || 0)
  let where = 'connection_id = ?'
  const params = [req.params.id]
  if (req.query.date) {
    where += ` AND date(started_at / 1000, 'unixepoch') = ?`
    params.push(req.query.date)
  }
  const total = meta.prepare(`SELECT COUNT(*) AS c FROM backup_runs WHERE ${where}`).get(...params).c
  const rows = meta
    .prepare(`SELECT id, trigger_kind, status, error, started_at, finished_at, uploads FROM backup_runs WHERE ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)
  res.json({
    total,
    runs: rows.map((r) => ({
      id: r.id,
      trigger: r.trigger_kind,
      status: r.status,
      error: r.error,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      uploads: safeJson(r.uploads) || [],
    })),
  })
})

// Delete a specific uploaded backup artifact from storage. Irreversible —
// marks it `deleted` in the run's history rather than removing the row, so
// the date/status stays visible but Restore/Download disappear.
app.delete('/api/connections/:id/backup/runs/:runId/uploads/:destinationId', async (req, res) => {
  const run = meta.prepare('SELECT * FROM backup_runs WHERE id = ? AND connection_id = ?').get(req.params.runId, req.params.id)
  if (!run) return res.status(404).json({ error: 'Backup run not found' })
  const uploads = safeJson(run.uploads) || []
  const upload = uploads.find((u) => u.destinationId === req.params.destinationId && u.ok && !u.deleted)
  if (!upload?.key) return res.status(404).json({ error: 'No deletable upload found for this destination' })
  const dest = getStorage(req.params.destinationId)
  if (!dest) return res.status(404).json({ error: 'Storage destination not found' })
  try {
    await deleteStorageObjects(dest, [upload.key])
  } catch (err) {
    return res.status(500).json({ error: describeError(err) })
  }
  const next = uploads.map((u) => (u.destinationId === req.params.destinationId ? { ...u, deleted: true } : u))
  meta.prepare('UPDATE backup_runs SET uploads = ? WHERE id = ?').run(JSON.stringify(next), run.id)
  res.json({ ok: true })
})

// Download a specific uploaded backup artifact (decrypted server-side first, if needed).
app.get('/api/connections/:id/backup/runs/:runId/uploads/:destinationId/download', async (req, res) => {
  const run = meta.prepare('SELECT * FROM backup_runs WHERE id = ? AND connection_id = ?').get(req.params.runId, req.params.id)
  if (!run) return res.status(404).json({ error: 'Backup run not found' })
  const uploads = safeJson(run.uploads) || []
  const upload = uploads.find((u) => u.destinationId === req.params.destinationId && u.ok && !u.deleted)
  if (!upload?.key) return res.status(404).json({ error: 'No downloadable upload found for this destination' })
  const dest = getStorage(req.params.destinationId)
  if (!dest) return res.status(404).json({ error: 'Storage destination not found' })
  const conn = getConnection(req.params.id)

  const tmpPath = path.join(BACKUP_TMP_DIR, `${randomUUID()}-dl`)
  let decPath = null
  const cleanup = () => {
    fs.rm(tmpPath, { force: true }, () => {})
    if (decPath) fs.rm(decPath, { force: true }, () => {})
  }
  try {
    await fetchStorageObjectToFile(dest, upload.key, tmpPath)
    const filePath = upload.encrypted ? (decPath = await decryptFileToFile(tmpPath)) : tmpPath
    const ext = conn?.type === 'postgresql' ? 'dump' : 'sqlite'
    const filename = `${sanitizeForKey(conn?.name)}-${new Date(run.started_at).toISOString().slice(0, 10)}.${ext}`
    res.download(filePath, filename, (err) => {
      cleanup()
      if (err && !res.headersSent) res.status(500).json({ error: describeError(err) })
    })
  } catch (err) {
    cleanup()
    res.status(500).json({ error: describeError(err) })
  }
})

// Restore: download a past backup artifact and overwrite a connection's live
// data in place. Defaults to the source connection; `targetConnectionId` may
// point at any other connection in the same workspace of the same type.
// Gated by typing the *target* connection's name to confirm.
app.post('/api/connections/:id/backup/restore', async (req, res) => {
  const sourceConn = getConnection(req.params.id)
  if (!sourceConn) return res.status(404).json({ error: 'Connection not found' })
  const { runId, destinationId, confirmName, targetConnectionId } = req.body || {}
  const targetConn = targetConnectionId ? getConnection(targetConnectionId) : sourceConn
  if (!targetConn) return res.status(404).json({ error: 'Target connection not found' })
  if (targetConn.workspaceId !== sourceConn.workspaceId) return res.status(400).json({ error: 'Target connection must be in the same workspace' })
  if (targetConn.type !== sourceConn.type) return res.status(400).json({ error: 'Target connection must be the same database type' })
  if (!RESTORABLE_TYPES.has(targetConn.type)) return res.status(400).json({ error: `Restore not supported for connection type: ${targetConn.type}` })
  if (confirmName !== targetConn.name) return res.status(400).json({ error: "Confirmation text doesn't match the target connection's name." })

  const run = meta.prepare('SELECT * FROM backup_runs WHERE id = ? AND connection_id = ?').get(runId, req.params.id)
  if (!run) return res.status(404).json({ error: 'Backup run not found' })
  const uploads = safeJson(run.uploads) || []
  const upload = uploads.find((u) => u.destinationId === destinationId && u.ok && !u.deleted)
  if (!upload?.key) return res.status(400).json({ error: 'No successful upload found for this destination' })
  const dest = getStorage(destinationId)
  if (!dest) return res.status(404).json({ error: 'Storage destination not found' })

  const tmpPath = path.join(BACKUP_TMP_DIR, `${randomUUID()}-restore`)
  let decPath = null
  try {
    await fetchStorageObjectToFile(dest, upload.key, tmpPath)
    const dumpPath = upload.encrypted ? (decPath = await decryptFileToFile(tmpPath)) : tmpPath
    await restoreDumpIntoConnection(targetConn, dumpPath)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: describeError(err) })
  } finally {
    fs.rm(tmpPath, { force: true }, () => {})
    if (decPath) fs.rm(decPath, { force: true }, () => {})
  }
})

// ---- Restore from arbitrary sources (storage browse / file upload) ----
// Unlike the run-based restore above, these restore into connection `:id`
// itself (the route param is the target), gated by typing its name. Encrypted
// artifacts (*.enc, written by the schedule's Encrypt option) are decrypted
// server-side with this server's key.

// A storage destination this connection may restore from: the built-in local
// disk, or an S3 destination belonging to the connection's workspace.
function storageForRestore(conn, destinationId) {
  const dest = destinationId ? getStorage(destinationId) : null
  if (!dest) return null
  if (!dest.local && dest.workspaceId !== conn.workspaceId) return null
  return dest
}

// Browse a destination's stored files so the user can pick one to restore.
app.get('/api/connections/:id/restore/storage-objects', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  const dest = storageForRestore(conn, req.query.destinationId)
  if (!dest) return res.status(404).json({ error: 'Storage destination not found' })
  try {
    res.json({ objects: await listStorageObjects(dest) })
  } catch (err) {
    res.status(500).json({ error: describeError(err) })
  }
})

// Restore from a picked storage object.
app.post('/api/connections/:id/restore/from-storage', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  const { destinationId, key, confirmName } = req.body || {}
  if (!RESTORABLE_TYPES.has(conn.type)) return res.status(400).json({ error: `Restore not supported for connection type: ${conn.type}` })
  if (confirmName !== conn.name) return res.status(400).json({ error: "Confirmation text doesn't match the connection's name." })
  if (typeof key !== 'string' || !key) return res.status(400).json({ error: 'An object key is required' })
  const dest = storageForRestore(conn, destinationId)
  if (!dest) return res.status(404).json({ error: 'Storage destination not found' })
  // Local keys must resolve inside LOCAL_BACKUP_DIR — no path traversal.
  if (dest.local && !path.resolve(LOCAL_BACKUP_DIR, key).startsWith(LOCAL_BACKUP_DIR + path.sep)) {
    return res.status(400).json({ error: 'Invalid object key' })
  }

  const tmpPath = path.join(BACKUP_TMP_DIR, `${randomUUID()}-restore`)
  let decPath = null
  try {
    await fetchStorageObjectToFile(dest, key, tmpPath)
    const dumpPath = key.endsWith('.enc') ? (decPath = await decryptFileToFile(tmpPath)) : tmpPath
    await restoreDumpIntoConnection(conn, dumpPath)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: describeError(err) })
  } finally {
    fs.rm(tmpPath, { force: true }, () => {})
    if (decPath) fs.rm(decPath, { force: true }, () => {})
  }
})

// Restore from an uploaded backup file. The file streams straight from the
// request body (Content-Type: application/octet-stream, which express.json
// ignores) into a temp file — no multipart parser needed. `filename` and
// `confirmName` ride the query string.
const UPLOAD_RESTORE_MAX_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB

app.post('/api/connections/:id/restore/upload', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  if (!RESTORABLE_TYPES.has(conn.type)) return res.status(400).json({ error: `Restore not supported for connection type: ${conn.type}` })
  if (req.query.confirmName !== conn.name) return res.status(400).json({ error: "Confirmation text doesn't match the connection's name." })
  const declared = parseInt(req.headers['content-length'])
  if (declared > UPLOAD_RESTORE_MAX_BYTES) return res.status(413).json({ error: 'Upload exceeds the 2 GB restore limit' })

  const filename = String(req.query.filename || '')
  const tmpPath = path.join(BACKUP_TMP_DIR, `${randomUUID()}-upload`)
  let decPath = null
  try {
    let received = 0
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        received += chunk.length
        cb(received > UPLOAD_RESTORE_MAX_BYTES ? new Error('Upload exceeds the 2 GB restore limit') : null, chunk)
      },
    })
    await pipeline(req, counter, fs.createWriteStream(tmpPath))
    if (received === 0) return res.status(400).json({ error: 'The uploaded file is empty' })
    const dumpPath = filename.endsWith('.enc') ? (decPath = await decryptFileToFile(tmpPath)) : tmpPath
    await restoreDumpIntoConnection(conn, dumpPath)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: describeError(err) })
  } finally {
    fs.rm(tmpPath, { force: true }, () => {})
    if (decPath) fs.rm(decPath, { force: true }, () => {})
  }
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

// ---- Schema migrations (per connection) ----
// Records a DDL commit that has already been executed (via /query) — one row
// per successful commitChanges() batch, bumping the connection's schema
// version. Audit trail only; nothing here re-executes SQL or reverts it.
app.post('/api/connections/:id/schema/migrations', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const statements = Array.isArray(req.body?.statements) ? req.body.statements : []
  if (!statements.length) return res.status(400).json({ error: 'At least one statement is required' })
  const version = bumpSchemaVersion(req.params.id)
  const entry = {
    id: randomUUID(),
    connectionId: req.params.id,
    version,
    forwardSql: statements.map((s) => s.sql),
    rollbackSql: statements.map((s) => s.rollbackSql || null),
    reversible: statements.every((s) => !!s.rollbackSql),
    executorId: user.id,
    executorName: user.name || user.username,
    ts: Date.now(),
  }
  meta
    .prepare(
      `INSERT INTO schema_migrations
       (id, connection_id, version, forward_sql, rollback_sql, reversible, status, executor_id, executor_name, ts)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    )
    .run(
      entry.id,
      entry.connectionId,
      entry.version,
      JSON.stringify(entry.forwardSql),
      JSON.stringify(entry.rollbackSql),
      entry.reversible ? 1 : 0,
      entry.executorId,
      entry.executorName,
      entry.ts
    )
  res.json({ version, migration: { ...entry, status: 'active' } })
})

// List a connection's schema migration history, newest first. `ORDER BY ts`
// (not version) so rolled-back rows that share a reused version number keep
// their real chronological order.
app.get('/api/connections/:id/schema/migrations', (req, res) => {
  const rows = meta
    .prepare(
      `SELECT id, version, forward_sql, rollback_sql, reversible, status, executor_id, executor_name, ts
       FROM schema_migrations WHERE connection_id = ? ORDER BY ts DESC`
    )
    .all(req.params.id)
  res.json(
    rows.map((r) => ({
      id: r.id,
      version: r.version,
      forwardSql: safeJson(r.forward_sql) || [],
      rollbackSql: safeJson(r.rollback_sql) || [],
      reversible: !!r.reversible,
      status: r.status || 'active',
      executorId: r.executor_id || null,
      executorName: r.executor_name || r.executor_id || null,
      ts: r.ts,
    }))
  )
})

// Roll the schema back to a target version. Runs the down (rollback) SQL for
// every still-active migration newer than `toVersion` — newest first — then
// marks those migrations 'rollbacked' and resets the connection's schema
// version to `toVersion`. The target version itself stays active. A later
// commit reuses the next number (e.g. rolling 3→1 then committing yields a new
// v2), so version numbers are not globally unique — status distinguishes them.
app.post('/api/connections/:id/schema/rollback', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  const toVersion = Number(req.body?.toVersion)
  if (!Number.isInteger(toVersion) || toVersion < 0) {
    return res.status(400).json({ error: 'A valid target version is required' })
  }
  const { database, schema } = req.body || {}

  // Still-active migrations newer than the target, newest first — these get undone.
  const rows = meta
    .prepare(
      `SELECT id, version, forward_sql, rollback_sql, reversible
       FROM schema_migrations
       WHERE connection_id = ? AND version > ? AND COALESCE(status, 'active') = 'active'
       ORDER BY version DESC`
    )
    .all(req.params.id, toVersion)

  if (!rows.length) return res.status(400).json({ error: 'Nothing to roll back for that version' })
  const irreversible = rows.find((r) => !r.reversible)
  if (irreversible) {
    return res.status(400).json({ error: `v${irreversible.version} is not reversible — can't roll back past it` })
  }

  // Undo each migration's statements in reverse order (last applied, first undone).
  try {
    for (const r of rows) {
      const downs = (safeJson(r.rollback_sql) || []).filter(Boolean).reverse()
      for (const sql of downs) {
        await execSqlOnConnection(conn, sql, database, schema)
      }
    }
  } catch (error) {
    return res.status(500).json({ error: `Rollback failed: ${error.message}` })
  }

  const markRolledBack = meta.prepare(`UPDATE schema_migrations SET status = 'rollbacked' WHERE id = ?`)
  const tx = meta.transaction((list) => list.forEach((r) => markRolledBack.run(r.id)))
  tx(rows)
  meta.prepare('UPDATE connections SET schema_version = ?, updated_at = ? WHERE id = ?').run(toVersion, Date.now(), req.params.id)

  res.json({ version: toVersion, rolledBack: rows.map((r) => r.version) })
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

// Analyze query performance — EXPLAIN-based, normalized across dialects.
// Read-only SELECTs also run for real timings; writes are never executed.
app.post('/api/connections/:id/analyze', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  const { sql, database, schema } = req.body
  if (!sql || !sql.trim()) {
    return res.status(400).json({ error: 'SQL query required' })
  }

  try {
    const stripped = stripSqlComments(sql)
    const statements = splitSqlStatements(stripped)
    if (statements.length !== 1) throw new Error('Only a single statement can be analyzed.')
    // Drop any EXPLAIN prefix the user already typed so we don't explain an EXPLAIN.
    const statement = statements[0].replace(/^explain\s+(query\s+plan\s+|analyze\s+|\([^)]*\)\s*)?/i, '')
    const cls = classifyStatement(statement)

    let result
    if (conn.type === 'sqlite') {
      result = await analyzeSqlite(getSqliteDb(conn.filepath), statement, cls)
    } else if (conn.type === 'postgresql') {
      result = await analyzePostgres(getPostgresPool(conn, database), statement, schema, cls)
    } else {
      throw new Error(`Query analysis is not supported for ${conn.type} connections.`)
    }
    res.json(result)
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
    const result = await execSqlOnConnection(conn, sql, database, schema)
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ============================================================================
// System / Updates — in-app update checking, backup, pre-flight and apply.
// Detection compares the running (version, sha) against the latest published
// GitHub Release + its release.json contract. Applying self-updates via the
// Docker socket when mounted, else returns a manual `docker compose pull`.
// ============================================================================

const UPDATE_IMAGE = process.env.UPDATE_IMAGE || 'ghcr.io/aidapedia/tabletsgo'
const UPDATE_REPO = process.env.UPDATE_REPO || 'aidapedia/tabletsgo'
// Instance-wide default for the per-user "auto-check for updates" preference.
// Off by default so orchestrator-managed deployments (e.g. Coolify) don't poll
// GitHub on every sign-in; the Settings > Updates toggle overrides it per browser.
const AUTO_CHECK_UPDATES = /^(1|true|yes|on)$/i.test(String(process.env.UPDATE_AUTO_CHECK || ''))
const UPDATE_CACHE_MS = 30 * 60 * 1000
let updateCache = null // { at, data }

// ---- Docker socket self-update ----
// When the Docker socket is mounted into this (containerized) app, it can update
// itself with no external tool: pull the new image, clone the running container's
// resolved config, and hand the final stop/rename/start swap to a tiny detached
// `docker:cli` helper (so the swap survives this process being stopped).
// Without the socket, the wizard falls back to a manual `docker compose pull`.
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock'
const UPDATE_HELPER_IMAGE = process.env.UPDATE_HELPER_IMAGE || 'docker:cli'
// Only offer Docker self-update when the socket is present AND we're actually
// inside a container (avoids a false positive in local dev on a machine that
// happens to run Docker Desktop).
const dockerSelfUpdateAvailable = () => {
  try {
    return fs.statSync(DOCKER_SOCKET).isSocket() && fs.existsSync('/.dockerenv')
  } catch {
    return false
  }
}
const updateApplyMethod = () => (dockerSelfUpdateAvailable() ? 'docker' : 'manual')

// Minimal Docker Engine API client over the unix socket. `raw` returns the body
// as text (used for the streamed image-pull progress).
function dockerApi(method, apiPath, { body, raw = false, timeout = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const req = http.request(
      {
        socketPath: DOCKER_SOCKET,
        path: apiPath,
        method,
        headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
      },
      (res) => {
        let chunks = ''
        res.on('data', (c) => (chunks += c))
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(`Docker API ${method} ${apiPath} -> ${res.statusCode}: ${chunks.slice(0, 300)}`))
          if (raw) return resolve(chunks)
          try {
            resolve(chunks ? JSON.parse(chunks) : {})
          } catch {
            resolve(chunks)
          }
        })
      },
    )
    req.setTimeout(timeout, () => req.destroy(new Error(`Docker API ${apiPath} timed out`)))
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

const splitImageRef = (ref) => {
  const slash = ref.lastIndexOf('/')
  const colon = ref.lastIndexOf(':')
  if (colon > slash) return { name: ref.slice(0, colon), tag: ref.slice(colon + 1) }
  return { name: ref, tag: 'latest' }
}

// Self-update via the Docker socket. Throws on any failure so the caller can
// surface a clear error (and the UI can fall back to the manual command).
async function dockerSelfUpdate() {
  const selfId = process.env.HOSTNAME || os.hostname()
  const inspect = await dockerApi('GET', `/containers/${selfId}/json`)
  const imageRef = inspect.Config?.Image
  if (!imageRef) throw new Error('Could not determine the running image')
  const oldName = (inspect.Name || '').replace(/^\//, '')

  // Pull the current tag (e.g. :latest) so it now resolves to the newest digest,
  // and make sure the helper image is present.
  const { name, tag } = splitImageRef(imageRef)
  await dockerApi('POST', `/images/create?fromImage=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`, { raw: true })
  const helper = splitImageRef(UPDATE_HELPER_IMAGE)
  await dockerApi('POST', `/images/create?fromImage=${encodeURIComponent(helper.name)}&tag=${encodeURIComponent(helper.tag)}`, { raw: true })

  // Clone the running container's resolved config onto the new image. Using the
  // live config (not the compose file) keeps env/secrets intact regardless of
  // how they were supplied.
  const cfg = inspect.Config || {}
  const nets = inspect.NetworkSettings?.Networks || {}
  const shortId = (inspect.Id || '').slice(0, 12)
  const EndpointsConfig = {}
  for (const [netName, n] of Object.entries(nets)) {
    EndpointsConfig[netName] = { Aliases: (n.Aliases || []).filter((a) => a !== shortId) }
  }
  const spec = {
    Image: imageRef,
    Env: cfg.Env,
    Cmd: cfg.Cmd,
    Entrypoint: cfg.Entrypoint,
    Labels: cfg.Labels,
    WorkingDir: cfg.WorkingDir,
    ExposedPorts: cfg.ExposedPorts,
    Volumes: cfg.Volumes,
    HostConfig: inspect.HostConfig,
    NetworkingConfig: { EndpointsConfig },
  }
  const created = await dockerApi('POST', `/containers/create?name=${encodeURIComponent(oldName)}-update-${Date.now()}`, { body: spec })
  const newId = created.Id

  // Hand the swap to a detached helper: it stops+removes us, takes our name, and
  // starts the new container. AutoRemove cleans the helper up afterwards.
  const script = `sleep 2; docker stop ${selfId}; docker rm -f ${selfId}; docker rename ${newId} ${oldName}; docker start ${newId}`
  const helperC = await dockerApi('POST', '/containers/create', {
    body: {
      Image: UPDATE_HELPER_IMAGE,
      Cmd: ['sh', '-c', script],
      HostConfig: { AutoRemove: true, Binds: [`${DOCKER_SOCKET}:/var/run/docker.sock`] },
    },
  })
  await dockerApi('POST', `/containers/${helperC.Id}/start`)
  return { newContainerId: newId }
}

// A user is an "instance admin" for update purposes if they're an admin of any
// workspace (updates are instance-wide, not scoped to one workspace).
const isAnyWorkspaceAdmin = (userId) =>
  !!meta.prepare("SELECT 1 FROM workspace_members WHERE user_id = ? AND role = 'admin' LIMIT 1").get(userId)
const requireSystemAdmin = (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return null
  if (!isAnyWorkspaceAdmin(user.id)) {
    res.status(403).json({ error: 'Admin access required' })
    return null
  }
  return user
}

async function fetchJson(url, { headers = {}, timeout = 8000 } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'tabletsgo', Accept: 'application/json', ...headers }, signal: ctrl.signal })
    if (!res.ok) throw new Error(`${url} -> ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

const parseSemver = (v) => {
  const m = String(v || '').replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/)
  return m ? [+m[1], +m[2], +m[3]] : null
}
// >0 if a newer than b, <0 if older, 0 if equal/unparseable.
const cmpSemver = (a, b) => {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

// Resolve the update state from GitHub Releases + the release.json contract.
// Never throws — network failure degrades to { unreachable: true }.
async function computeUpdateInfo() {
  const current = { version: APP_VERSION, sha: GIT_SHA }
  const base = {
    current,
    applyMethod: updateApplyMethod(),
    checkedAt: Date.now(),
  }
  try {
    const releases = await fetchJson(`https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=10`)
    const published = (Array.isArray(releases) ? releases : []).filter((r) => !r.draft)
    if (!published.length) {
      return { ...base, latest: null, updateAvailable: false, image: `${UPDATE_IMAGE}:latest`, releases: [] }
    }
    const latestRel = published[0]
    const latestTag = (latestRel.tag_name || '').replace(/^v/, '')

    // release.json is the machine-readable contract; fall back to tag-only.
    let contract = {}
    const asset = (latestRel.assets || []).find((a) => a.name === 'release.json')
    if (asset) {
      try {
        contract = await fetchJson(asset.browser_download_url)
      } catch {
        // Missing/broken contract — treat as a plain tagged release.
      }
    }
    const latest = { version: contract.version || latestTag, sha: contract.sha || null }
    // Update state is purely version-tag driven: a newer release version means
    // an update is available. Same-version rebuilds (moving-tag re-pushes) are
    // intentionally ignored so "v0.16.3 → v0.16.3" never prompts an update.
    const versionDelta = cmpSemver(latest.version, current.version)
    const updateAvailable = versionDelta > 0

    const minUpgradeFrom = contract.minUpgradeFrom || null
    const upgradeBlocked = !!(minUpgradeFrom && cmpSemver(current.version, minUpgradeFrom) < 0)

    const notes = published
      .filter((r) => cmpSemver((r.tag_name || '').replace(/^v/, ''), current.version) > 0)
      .map((r) => ({
        version: (r.tag_name || '').replace(/^v/, ''),
        name: r.name || r.tag_name,
        notes: r.body || '',
        url: r.html_url,
        publishedAt: r.published_at,
      }))

    return {
      ...base,
      latest,
      updateAvailable,
      breaking: !!contract.breaking,
      migrations: !!contract.migrations,
      minUpgradeFrom,
      upgradeBlocked,
      image: `${UPDATE_IMAGE}:${latest.version}`,
      releases: notes,
    }
  } catch (e) {
    return { ...base, latest: null, updateAvailable: false, unreachable: true, error: e.message, image: `${UPDATE_IMAGE}:latest`, releases: [] }
  }
}

// The running app's identity — cheap; used by the wizard's verify-poll.
app.get('/api/system/version', (req, res) => {
  if (!requireAuth(req, res)) return
  res.json({ name: APP_NAME, version: APP_VERSION, sha: GIT_SHA, autoCheckUpdates: AUTO_CHECK_UPDATES })
})

// Check for a newer release (cached ~30 min; ?refresh=1 bypasses the cache).
app.get('/api/system/update/check', async (req, res) => {
  if (!requireAuth(req, res)) return
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true'
  if (!refresh && updateCache && Date.now() - updateCache.at < UPDATE_CACHE_MS) {
    return res.json(updateCache.data)
  }
  const data = await computeUpdateInfo()
  updateCache = { at: Date.now(), data }
  res.json(data)
})

// Snapshot the metadata DB before updating (rollback insurance).
app.post('/api/system/backup', async (req, res) => {
  if (!requireSystemAdmin(req, res)) return
  try {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true })
    const file = `app-${APP_VERSION}-${Date.now()}.db`
    const dest = path.join(BACKUPS_DIR, file)
    await meta.backup(dest)
    res.json({ ok: true, file, sizeBytes: fs.statSync(dest).size, createdAt: Date.now() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Download a previously-taken snapshot.
app.get('/api/system/backup/:file/download', (req, res) => {
  if (!requireSystemAdmin(req, res)) return
  const safe = path.basename(req.params.file)
  const full = path.join(BACKUPS_DIR, safe)
  if (path.dirname(full) !== BACKUPS_DIR || !fs.existsSync(full)) {
    return res.status(404).json({ error: 'Backup not found' })
  }
  res.download(full, safe)
})

// Pre-flight validation before applying an update.
app.get('/api/system/preflight', (req, res) => {
  if (!requireSystemAdmin(req, res)) return
  const checks = []

  try {
    const r = meta.pragma('integrity_check', { simple: true })
    checks.push({ id: 'integrity', label: 'Metadata database integrity', status: r === 'ok' ? 'pass' : 'fail', detail: r === 'ok' ? 'No corruption detected' : String(r) })
  } catch (e) {
    checks.push({ id: 'integrity', label: 'Metadata database integrity', status: 'fail', detail: e.message })
  }

  try {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true })
    const st = fs.statfsSync(BACKUPS_DIR)
    const freeBytes = st.bavail * st.bsize
    const metaSize = fs.existsSync(META_DB_PATH) ? fs.statSync(META_DB_PATH).size : 0
    const ok = freeBytes > metaSize * 3 + 50e6
    checks.push({ id: 'disk', label: 'Free disk for snapshot', status: ok ? 'pass' : 'warn', detail: `${Math.round(freeBytes / 1e6)} MB free` })
  } catch {
    checks.push({ id: 'disk', label: 'Free disk for snapshot', status: 'warn', detail: 'Could not determine free space' })
  }

  const applyMethod = updateApplyMethod()
  checks.push({
    id: 'apply',
    label: 'Update apply method',
    status: applyMethod === 'docker' ? 'pass' : 'warn',
    detail:
      applyMethod === 'docker'
        ? 'Docker socket detected — one-click self-update available'
        : 'No Docker socket — a manual pull will be required',
  })

  const info = updateCache?.data
  if (info?.upgradeBlocked) {
    checks.push({ id: 'path', label: 'Upgrade path', status: 'fail', detail: `Upgrade from ${info.minUpgradeFrom}+ required first — step through intermediate versions` })
  } else if (info?.breaking) {
    checks.push({ id: 'breaking', label: 'Breaking changes', status: 'warn', detail: 'This release contains breaking changes — review the changelog' })
  }

  res.json({ checks })
})

// Trigger the update. Self-updates via the Docker socket when available; without
// it, returns the manual command for the UI to display.
app.post('/api/system/update/apply', async (req, res) => {
  if (!requireSystemAdmin(req, res)) return
  const tag = (req.body && req.body.tag) || updateCache?.data?.latest?.version || 'latest'

  if (dockerSelfUpdateAvailable()) {
    try {
      const r = await dockerSelfUpdate()
      return res.json({ ok: true, method: 'docker', message: 'Pulling the new image and recreating the container — this will restart shortly.', ...r })
    } catch (e) {
      console.error('Docker self-update failed:', e.message)
      return res.status(500).json({ error: `Docker self-update failed: ${e.message}` })
    }
  }

  res.json({ ok: false, method: 'manual', command: 'docker compose pull && docker compose up -d', image: `${UPDATE_IMAGE}:${tag}` })
})

// Health check — also carries boot readiness + identity for the update flow.
app.get('/api/health', (req, res) => {
  res.json({ status: bootReady ? 'ok' : 'starting', ready: bootReady, version: APP_VERSION, sha: GIT_SHA })
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

// Find workflows due to run (schedule_enabled + next_run_at reached), execute
// each, and roll their next_run_at forward. Claiming next_run_at before the
// run starts means a slow run can't get double-fired by the next tick.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Email the workspace's chosen members when a scheduled backup ends up failed
// (after retries, if any — see runBackupWithRetries). Best-effort — never throws.
async function notifyBackupFailure(conn, result) {
  try {
    const wsRow = meta.prepare('SELECT * FROM workspaces WHERE id = ?').get(conn.workspaceId)
    if (!wsRow) return
    const cfg = safeJson(wsRow.settings).notifications?.backupFailure
    if (!cfg?.enabled || !cfg.memberIds?.length) return
    const smtp = smtpConfig(wsRow)
    if (!smtp) return
    const placeholders = cfg.memberIds.map(() => '?').join(',')
    const recipients = meta.prepare(`SELECT username FROM users WHERE id IN (${placeholders})`).all(...cfg.memberIds)
    const when = new Date().toISOString()
    for (const r of recipients) {
      try {
        await sendMail(smtp, {
          to: r.username,
          subject: `Backup failed for ${conn.name}`,
          text: `The scheduled backup for "${conn.name}" failed at ${when}.\n\nError: ${result.error || 'Unknown error'}`,
          html: `<p>The scheduled backup for <b>${conn.name}</b> failed at ${when}.</p><p style="color:#c00">${result.error || 'Unknown error'}</p>`,
        })
      } catch (e) {
        console.error('Backup failure notification email failed:', e.message)
      }
    }
  } catch (e) {
    console.error('notifyBackupFailure error:', e.message)
  }
}

async function runDueWorkflows() {
  const due = meta.prepare('SELECT * FROM workflows WHERE schedule_enabled = 1 AND next_run_at <= ?').all(Date.now())
  for (const wf of due) {
    const graph = safeJson(wf.graph)
    const schedNode = (graph?.nodes || []).find((n) => n.type === 'schedule')
    if (!schedNode?.data?.frequency || schedNode.data.frequency === 'manual') {
      // Schedule node was edited away from hourly/daily — stop trying to fire it.
      meta.prepare('UPDATE workflows SET schedule_enabled = 0, next_run_at = NULL WHERE id = ?').run(wf.id)
      continue
    }
    meta.prepare('UPDATE workflows SET next_run_at = ? WHERE id = ?').run(computeNextRun(schedNode.data.frequency, schedNode.data.hourOfDay), wf.id)
    const conn = getConnection(wf.connection_id)
    if (!conn) continue
    executeAndRecord(wf.id, wf.connection_id, conn, graph, 'schedule').catch((e) =>
      console.error(`Scheduled run failed for workflow ${wf.id}:`, e.message)
    )
  }
}

if (process.env.WORKFLOW_SCHEDULER_ENABLED !== 'false') {
  cron.schedule('* * * * *', () => {
    runDueWorkflows().catch((e) => console.error('Scheduler tick error:', e.message))
    runDueBackups().catch((e) => console.error('Backup scheduler tick error:', e.message))
  })
}

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
