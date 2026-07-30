/**
 * Folders — one tree per (connection, type), polymorphic by `type`.
 *
 * 'query' groups saved queries, 'dashboard' groups dashboards, 'workflow'
 * groups workflows, 'table' groups the connected database's tables. Each item
 * points back via its own `folder_id` column, and `parent_id` builds the tree
 * (NULL = root). Nesting caps are per type (queries uncapped for back-compat;
 * the rest capped at 3) and enforced here. Adding a new folderable resource =
 * one entry in FOLDER_TYPES + a `folder_id` column on its table.
 *
 * 'table' is the one type whose items don't live in the meta DB (tables belong
 * to the user's database), so its "item table" is `connection_tables` — the
 * per-table metadata row (one per connection+table), of which `folder_id` is
 * currently the only fact.
 */

import { meta } from './meta.js'

export const FOLDER_TYPES = {
  query: { itemTable: 'saved_queries', maxDepth: Infinity },
  dashboard: { itemTable: 'dashboards', maxDepth: 3 },
  workflow: { itemTable: 'workflows', maxDepth: 3 },
  table: { itemTable: 'connection_tables', maxDepth: 3 },
}

// Coerce an untrusted `type` to a known one (defaults to 'query' for older
// clients that predate the `type` param). Guards the itemTable interpolation.
export const folderTypeOf = (t) => (t && FOLDER_TYPES[t] ? t : 'query')

// parent_id lookup for one connection's folders of a given type.
export function folderParents(connectionId, type) {
  return new Map(
    meta
      .prepare('SELECT id, parent_id FROM folders WHERE connection_id = ? AND type = ?')
      .all(connectionId, type)
      .map((r) => [r.id, r.parent_id || null])
  )
}

// Levels from the root down to `folderId` (root folder = 1, NULL = 0).
export function folderDepth(connectionId, type, folderId, parentOf = folderParents(connectionId, type)) {
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
export function folderHeight(connectionId, type, folderId) {
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
export function folderHasAncestor(connectionId, type, folderId, candidateAncestor, parentOf = folderParents(connectionId, type)) {
  let cur = folderId
  const seen = new Set()
  while (cur && !seen.has(cur)) {
    if (cur === candidateAncestor) return true
    seen.add(cur)
    cur = parentOf.get(cur) || null
  }
  return false
}

// Table names grouped under a 'table' folder (empty for every other type —
// those items carry their own folder_id and are listed by their own endpoint).
export const folderTables = (connectionId, folderId) =>
  meta
    .prepare('SELECT table_name FROM connection_tables WHERE connection_id = ? AND folder_id = ? ORDER BY table_name ASC')
    .all(connectionId, folderId)
    .map((r) => r.table_name)

// API shape for one folder row.
export const folderRow = (connectionId, type, r) => ({
  id: r.id,
  name: r.name,
  color: r.color || null,
  parentId: r.parent_id || null,
  type,
  ts: r.ts,
  ...(type === 'table' ? { tables: folderTables(connectionId, r.id) } : null),
})
