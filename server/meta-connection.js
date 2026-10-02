/**
 * Opening the metadata database — the one place that knows which engine backs
 * it. meta.js holds the app's long-lived handle; the migrator opens short-lived
 * ones of its own, because Prisma Migrate cannot work on a SQLite file another
 * connection is holding open.
 */

import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { META_DATABASE_URL, META_DB_PATH, META_DB_TYPE } from './config.js'

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

export function openMeta() {
  if (postgres) return new postgres.PostgresMeta(META_DATABASE_URL)
  const db = new Database(META_DB_PATH)
  db.pragma('journal_mode = WAL')
  return db
}

// Synchronous metadata snapshot. SQLite checkpoints its WAL before copying;
// PostgreSQL uses pg_dump's custom archive format.
export function snapshotMeta(db, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  if (postgres) return db.backup(destPath)
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // Best-effort — a busy WAL just means the copy may trail the newest write.
  }
  fs.copyFileSync(META_DB_PATH, destPath)
  return fs.statSync(destPath).size
}
