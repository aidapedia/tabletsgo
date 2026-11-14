/**
 * `npm run hayat:remap -- hayat-result.json` — after `hayat import`, point
 * tabletsgo's references at the Hayat accounts some people already had.
 *
 * `hayat import` keeps each person's tabletsgo id, except when Hayat already
 * had an account for that email: the import then uses the existing account and
 * reports `idMap` { tabletsgoId: hayatId }. This rewrites every column that
 * holds a user id, so ownership, history and notification choices follow them.
 */
import fs from 'fs'
import { openMeta } from '../server/meta-connection.js'

const file = process.argv[2]
if (!file) {
  console.error('usage: npm run hayat:remap -- <the --out file of hayat import>')
  process.exit(1)
}
const idMap = JSON.parse(fs.readFileSync(file, 'utf8')).idMap || {}
const pairs = Object.entries(idMap)
if (!pairs.length) {
  console.log('Nothing to rewrite: every person kept their id.')
  process.exit(0)
}

// Every column holding a user id.
const COLUMNS = [
  ['connections', 'owner_id'],
  ['saved_queries', 'created_by'],
  ['saved_queries', 'updated_by'],
  ['schema_drafts', 'created_by'],
  ['schema_drafts', 'updated_by'],
  ['ssh_keys', 'created_by'],
  ['query_history', 'executor_id'],
  ['schema_migrations', 'executor_id'],
]

const db = openMeta()
let changed = 0
db.transaction(() => {
  for (const [from, to] of pairs) {
    for (const [table, column] of COLUMNS) {
      changed += db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(to, from).changes || 0
    }
  }
  // Who a workspace emails about failed backups lives in its settings blob.
  for (const w of db.prepare('SELECT id, settings FROM workspaces').all()) {
    let settings
    try {
      settings = JSON.parse(w.settings || '{}')
    } catch {
      continue
    }
    const ids = settings.notifications?.backupFailure?.memberIds
    if (!Array.isArray(ids) || !ids.some((id) => idMap[id])) continue
    settings.notifications.backupFailure.memberIds = ids.map((id) => idMap[id] || id)
    db.prepare('UPDATE workspaces SET settings = ? WHERE id = ?').run(JSON.stringify(settings), w.id)
    changed++
  }
})()
db.close()
console.log(`Rewrote ${changed} reference(s) for ${pairs.length} person(s).`)
