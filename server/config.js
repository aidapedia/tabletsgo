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
export const DIST_DIR = path.join(ROOT_DIR, 'dist')

// Connection credentials (host/port/username/password/…) are encrypted at rest
// with this key. Required — refuse to boot rather than silently store secrets
// in plaintext.
if (!process.env.ENCRYPTION_KEY) {
  console.error('❌ ENCRYPTION_KEY is not set. Set it in your environment (see .env.example) before starting the server.')
  process.exit(1)
}
export const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY

// ---- Metadata store (the app's own SQLite DB) ----
export const META_DB_PATH = process.env.META_DB || path.join(ROOT_DIR, 'data', 'app.db')
fs.mkdirSync(path.dirname(META_DB_PATH), { recursive: true })

// App-level snapshots of the meta DB (users/connections/etc.) — distinct from the
// S3 database backups feature. Both the boot pre-migration snapshot and the
// update wizard's manual backup land here.
export const BACKUPS_DIR = path.join(path.dirname(META_DB_PATH), 'backups')

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
export const UPDATE_IMAGE = process.env.UPDATE_IMAGE || 'ghcr.io/aidapedia/tabletsgo'
export const UPDATE_REPO = process.env.UPDATE_REPO || 'aidapedia/tabletsgo'
export const UPDATE_HELPER_IMAGE = process.env.UPDATE_HELPER_IMAGE || 'docker:cli'
export const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock'
// Instance-wide default for the per-user "auto-check for updates" preference.
// Off by default so orchestrator-managed deployments (e.g. Coolify) don't poll
// GitHub on every sign-in; the Settings > Updates toggle overrides it per browser.
export const AUTO_CHECK_UPDATES = /^(1|true|yes|on)$/i.test(String(process.env.UPDATE_AUTO_CHECK || ''))

// ---- Sessions ----
// Logins are stored in the meta DB (the source of truth) and read through a
// cache. SESSION_REDIS_URL (redis:// or rediss://) makes that cache Redis so
// replicas share it; without it the cache is per-process, which is still
// correct — a cache miss just falls through to the DB. Connection sessions are
// cache-only either way, so with more than one replica Redis is what lets them
// see each other's open handles (and enforce the limit). See server/sessions.
export const SESSION_REDIS_URL = process.env.SESSION_REDIS_URL || ''
export const SESSION_REDIS_PREFIX = process.env.SESSION_REDIS_PREFIX || 'tabletsgo:'
// Sliding lifetime of a login (bearer) session — refreshed on every request.
export const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS, 10) || 30 * 24 * 60 * 60 * 1000
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

// ---- Schedulers ----
export const SCHEDULER_ENABLED = process.env.WORKFLOW_SCHEDULER_ENABLED !== 'false'
