/**
 * Metadata store — a local SQLite DB that persists app data: users, workspaces,
 * saved connections, queries, workflows, dashboards and run history. Separate
 * from the databases the user connects to (those live behind server/db/).
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import { BACKUPS_DIR, META_DB_PATH } from './config.js'
import { encryptSecret, sha256 } from './crypto.js'
import { migrate } from './migrations.js'

export const meta = new Database(META_DB_PATH)
meta.pragma('journal_mode = WAL')

// A safe synchronous snapshot of the meta DB: checkpoint the WAL so the main
// file is complete, then copy it. Safe at boot (no concurrent writers) and
// reused by the update wizard's backup endpoint.
export function snapshotMetaSync(destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  try {
    meta.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // Best-effort — a busy WAL just means the copy may trail the newest write.
  }
  fs.copyFileSync(META_DB_PATH, destPath)
  return fs.statSync(destPath).size
}

export function initMetaDb() {
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

  seedAdminFromEnv()
}

// Optional pre-seed from env — skips the first-run setup wizard.
function seedAdminFromEnv() {
  const hasUsers = !!meta.prepare('SELECT 1 FROM users LIMIT 1').get()
  if (hasUsers || !process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) return

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
