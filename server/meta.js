/**
 * Metadata store — SQLite or PostgreSQL persists app data: users, workspaces,
 * saved connections, queries, workflows, dashboards and run history. Separate
 * from the databases the user connects to (those live behind server/db/).
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import { BACKUPS_DIR, META_DATABASE_URL, META_DB_PATH, META_DB_TYPE } from './config.js'
import { APP_SETTINGS_KEY, encryptSecret, sha256 } from './crypto.js'
import { migrate } from './migrations.js'

let postgres = null
if (META_DB_TYPE === 'postgresql') {
  try {
    postgres = await import('./postgres-meta.js')
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') {
      throw new Error('PostgreSQL metadata requires pg-native and libpq. Install PostgreSQL client development libraries, then reinstall dependencies.', { cause: error })
    }
    throw error
  }
}
export const meta = postgres ? new postgres.PostgresMeta(META_DATABASE_URL) : new Database(META_DB_PATH)
if (!postgres) meta.pragma('journal_mode = WAL')

// Synchronous metadata snapshot. SQLite checkpoints its WAL before copying;
// PostgreSQL uses pg_dump's custom archive format.
export function snapshotMetaSync(destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  if (postgres) return meta.backup(destPath)
  try {
    meta.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // Best-effort — a busy WAL just means the copy may trail the newest write.
  }
  fs.copyFileSync(META_DB_PATH, destPath)
  return fs.statSync(destPath).size
}

export function initMetaDb() {
  // SQLite keeps its shipped, append-only migration steps and snapshots an
  // existing file before upgrading. PostgreSQL bootstraps the equivalent v20
  // schema in a transaction and records its own version.
  if (postgres) postgres.migratePostgres(meta)
  else migrate(meta, {
    encryptSecret,
    // Secrets moving into app_settings are sealed under that namespace's key
    // (v10 promotes a workspace's plaintext SMTP password to the global config).
    encryptAppSetting: (plaintext) => encryptSecret(plaintext, APP_SETTINGS_KEY),
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

  seedAdminFromEnv()
}

// Optional pre-seed from env — skips the first-run setup wizard. Seeds the
// instance administrator and nothing else, exactly like the wizard: an admin
// administers workspaces but never belongs to one (CLAUDE.md "AUTH MODEL"), so
// a workspace created here could only be ownerless. The admin signs in and
// creates the first workspace with a real owner (Admin → Workspaces).
function seedAdminFromEnv() {
  const hasUsers = !!meta.prepare('SELECT 1 FROM users LIMIT 1').get()
  if (hasUsers || !process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) return

  meta
    .prepare('INSERT INTO users (id, username, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), process.env.ADMIN_USERNAME, sha256(process.env.ADMIN_PASSWORD), 'Admin', 'admin', 'active')
  console.log(`🌱 Seeded admin ${process.env.ADMIN_USERNAME} (create your first workspace from Admin → Workspaces)`)
}
