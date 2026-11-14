/**
 * Runtime configuration — every env var and filesystem path the server uses,
 * resolved once, in one place. Nothing here reaches into a database or does
 * work beyond creating the directories the app writes to, so every other module
 * can import it without ordering concerns.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// This file lives in server/, so the repo root is one level up. Paths that used
// to be relative to server.js resolve against ROOT_DIR.
export const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

export const PORT = process.env.PORT || 3000
// The address people reach this instance at. Needed behind a reverse proxy: it
// goes into emailed links, which otherwise come from the request.
export const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '')
export const DIST_DIR = path.join(ROOT_DIR, 'console', 'dist')
export const OPENAPI_PATH = path.join(ROOT_DIR, 'server', 'openapi.yaml')

// Connection credentials (host/port/username/password/…) are encrypted at rest
// with this key. Required — refuse to boot rather than silently store secrets
// in plaintext.
if (!process.env.ENCRYPTION_KEY) {
  console.error('❌ ENCRYPTION_KEY is not set. Set it in your environment (see .env.example) before starting the server.')
  process.exit(1)
}
export const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY

// ---- Metadata store (the app's own records, separate from user connections) ----
export const META_DB_TYPE = (process.env.META_DB_TYPE || 'sqlite').toLowerCase()
if (!['sqlite', 'postgresql'].includes(META_DB_TYPE)) throw new Error('META_DB_TYPE must be sqlite or postgresql')
export const META_DATABASE_URL = process.env.META_DATABASE_URL || ''
if (META_DB_TYPE === 'postgresql' && !META_DATABASE_URL) throw new Error('META_DATABASE_URL is required when META_DB_TYPE=postgresql')
export const META_DB_PATH = process.env.META_DB || path.join(ROOT_DIR, 'data', 'app.db')
if (META_DB_TYPE === 'sqlite') fs.mkdirSync(path.dirname(META_DB_PATH), { recursive: true })

// App-level snapshots of the meta DB (connections, saved queries, …) — distinct from the
// S3 database backups feature. Both the boot pre-migration snapshot and the
// update wizard's manual backup land here.
export const BACKUPS_DIR = path.join(META_DB_TYPE === 'sqlite' ? path.dirname(META_DB_PATH) : path.join(ROOT_DIR, 'data'), 'backups')

// ---- Backup working directories ----
// The reserved "local server disk" storage destination writes here; database
// dumps are staged in the tmp dir before they're uploaded.
export const LOCAL_BACKUP_DIR = path.join(ROOT_DIR, 'data', 'backups')
export const BACKUP_TMP_DIR = path.join(ROOT_DIR, 'data', 'tmp-backups')
fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true })
fs.mkdirSync(BACKUP_TMP_DIR, { recursive: true })

// ---- App identity (baked into the image at build time; package.json in dev) ----
// Reported by /api/system/version and /api/health, and compared against the
// latest published release to decide whether an update is available.
export const APP_NAME = 'tabletsgo'
export const GIT_SHA = process.env.GIT_SHA || 'dev'
export const APP_VERSION = resolveAppVersion()

function resolveAppVersion() {
  if (process.env.APP_VERSION) return process.env.APP_VERSION
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

// ---- In-app updates ----
// The image, release repo and helper image are constants in system-update.js —
// the app only ever updates to its own official release.
export const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock'

// ---- Hayat: who people are and what they may do ----
// Tabletsgo keeps no accounts of its own. People sign in at Hayat (an OpenID
// provider), and every permission question is asked of Hayat's service API.
// Required: server.js refuses to start without the four marked below.
const trimUrl = (v) => (v || '').trim().replace(/\/+$/, '')
// The auth role's public URL — tokens are verified against its published keys.
export const HAYAT_ISSUER = trimUrl(process.env.HAYAT_ISSUER) // required
// The same auth role as this server reaches it, when that differs from the public
// issuer (in Docker, `http://localhost:8443` is the container itself). Discovery,
// the token endpoint and the keys are fetched here; tokens still name HAYAT_ISSUER.
export const HAYAT_AUTH_URL = trimUrl(process.env.HAYAT_AUTH_URL) || HAYAT_ISSUER
// The api role (gRPC/Connect), reachable from this server only.
export const HAYAT_API_URL = trimUrl(process.env.HAYAT_API_URL) // required
// The service credentials Hayat issued when tabletsgo was registered.
export const HAYAT_CLIENT_ID = (process.env.HAYAT_CLIENT_ID || '').trim() // required
export const HAYAT_CLIENT_SECRET = process.env.HAYAT_CLIENT_SECRET || '' // required
// The public (PKCE) client the browser signs in with. Its own client, so the
// service secret above never reaches a browser.
export const HAYAT_WEB_CLIENT_ID = (process.env.HAYAT_WEB_CLIENT_ID || '').trim()
// Where people manage members, groups and grants. Optional: links to it are
// hidden without it.
export const HAYAT_CONSOLE_URL = trimUrl(process.env.HAYAT_CONSOLE_URL)
export const HAYAT_CONFIGURED = !!(HAYAT_ISSUER && HAYAT_API_URL && HAYAT_CLIENT_ID && HAYAT_CLIENT_SECRET && HAYAT_WEB_CLIENT_ID)

// ---- Sessions ----
// Connection sessions only — a login is a Hayat access token, verified on every
// request and never stored here. A connection session describes a live driver
// handle *this* process holds, so it lives in memory, which also means the
// session limit is enforced per replica. See server/sessions. (The app has no
// Redis of its own; server/db/redis.js is the Redis a *user* connects to as a
// database, which is unrelated.)
// How long a *connection* session (one open driver handle/pool) survives with
// no activity before it's swept and its handle released.
export const SESSION_IDLE_TTL_MS = parseInt(process.env.SESSION_IDLE_TTL_MS, 10) || 15 * 60 * 1000
// Instance-wide fallback for "max concurrent sessions per connection", used
// when neither the connection nor its workspace sets one. 0 = unlimited.
export const MAX_SESSIONS_PER_CONNECTION = parseInt(process.env.MAX_SESSIONS_PER_CONNECTION, 10) || 0

// ---- Connections ----
// How long the pre-flight handshake (GET /api/connections/:id/handshake) waits
// for a database to answer before it reports a timeout. Kept short: it runs
// while the user waits on the "Connect" button, and a black-holed host would
// otherwise ride the driver's own multi-minute TCP timeout.
export const HANDSHAKE_TIMEOUT_MS = parseInt(process.env.HANDSHAKE_TIMEOUT_MS, 10) || 8000

// Kafka's read caps (messages / bytes / time per read) are not env vars: an
// instance admin sets them in Admin → Modules — see server/module-registry.js.

// ---- Schedulers ----
export const SCHEDULER_ENABLED = process.env.WORKFLOW_SCHEDULER_ENABLED !== 'false'
