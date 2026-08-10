/**
 * Connection export / import — one portable JSON document per connection.
 *
 * In the bundle: connection settings (as an opaque, dialect-agnostic `settings`
 * object, so a new database type needs no change here), folders of all four
 * types with their tree + colors, table→folder assignments, saved queries,
 * workflows, dashboards and the backup schedule.
 *
 * Deliberately left out: history/audit rows (query_history, workflow_runs,
 * backup_runs, schema_migrations) and connection_access grants — they describe
 * *this* instance, not the connection's configuration, and their principals
 * (users, teams) don't exist in the importing workspace.
 *
 * When you add a new per-connection resource, add it here alongside the
 * `DELETE /api/connections/:id` cascade — the two lists should stay in sync.
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { APP_NAME, APP_VERSION, BACKUP_TMP_DIR } from './config.js'
import { meta } from './meta.js'
import { getConnection, saveConnection } from './connections.js'
import { FOLDER_TYPES, folderTypeOf } from './folders.js'
import { LOCAL_STORAGE_ID, listStorageRows } from './storage.js'
import { createSchedule, getBackupSchedule } from './backup/schedule.js'
import { safeJson } from './util.js'

export const CONNECTION_EXPORT_VERSION = 1
// Credential fields kept out of an export unless the caller opts in (?secrets=1).
const CONNECTION_SECRET_FIELDS = ['password']
// Same shape as the frontend's genWebhookToken — an opaque, URL-safe token.
const mintWebhookToken = () => (randomUUID() + randomUUID()).replace(/-/g, '')

// Blank the password embedded in a connection URI (`postgres://u:p@host/db`).
function redactUriPassword(uri) {
  try {
    const u = new URL(uri)
    if (!u.password) return uri
    u.password = ''
    return u.toString()
  } catch {
    return uri
  }
}

// Webhook tokens are secrets and never round-trip through an export file —
// import mints a fresh one (mirrors the frontend's stripSecrets/sanitizeGraph).
function stripWorkflowGraphSecrets(graph) {
  const nodes = (graph?.nodes || []).map((n) => {
    const { __status, ...data } = n?.data && typeof n.data === 'object' ? n.data : {}
    if (n?.type === 'webhook') {
      const { token, ...rest } = data
      return { ...n, data: rest }
    }
    return { ...n, data }
  })
  return { nodes, edges: graph?.edges || [] }
}

// Build the export document for one connection. `includeSecrets` keeps the
// stored password (for moving a connection between instances verbatim);
// otherwise every secret field is dropped and the importer supplies it.
export function buildConnectionExport(connectionId, { includeSecrets = false } = {}) {
  const conn = getConnection(connectionId)
  if (!conn) return null
  // Peel off the identity/ownership columns — an import re-creates them.
  const { id, workspaceId, ownerId, ownerName, ownerEmail, schemaVersion, type, name, environment, folder, tags, ...settings } = conn
  if (!includeSecrets) {
    for (const f of CONNECTION_SECRET_FIELDS) delete settings[f]
    if (typeof settings.uri === 'string' && settings.uri) settings.uri = redactUriPassword(settings.uri)
  }

  const folders = meta
    .prepare('SELECT id, type, name, color, parent_id, ts FROM folders WHERE connection_id = ? ORDER BY ts ASC')
    .all(connectionId)
    .map((r) => ({ id: r.id, type: r.type, name: r.name, color: r.color || null, parentId: r.parent_id || null, ts: r.ts }))

  const tableFolders = meta
    .prepare('SELECT table_name, folder_id FROM connection_tables WHERE connection_id = ? AND folder_id IS NOT NULL ORDER BY table_name ASC')
    .all(connectionId)
    .map((r) => ({ tableName: r.table_name, folderId: r.folder_id }))

  const savedQueries = meta
    .prepare('SELECT id, name, sql, kind, folder_id, layout, ts FROM saved_queries WHERE connection_id = ? ORDER BY ts ASC')
    .all(connectionId)
    .map((r) => ({
      id: r.id,
      name: r.name,
      sql: r.sql,
      kind: r.kind || 'query',
      folderId: r.folder_id || null,
      // A schema draft's diagram arrangement travels with it — a bundle that
      // dropped it would import the DDL and re-scatter the diagram.
      layout: r.layout ? safeJson(r.layout) : null,
      ts: r.ts,
    }))

  const workflows = meta
    .prepare('SELECT id, name, graph, folder_id, schedule_enabled, ts FROM workflows WHERE connection_id = ? ORDER BY ts ASC')
    .all(connectionId)
    .map((r) => ({
      id: r.id,
      name: r.name,
      graph: stripWorkflowGraphSecrets(safeJson(r.graph) || { nodes: [], edges: [] }),
      folderId: r.folder_id || null,
      scheduleEnabled: !!r.schedule_enabled,
      ts: r.ts,
    }))

  const dashboards = meta
    .prepare('SELECT id, name, config, folder_id, ts FROM dashboards WHERE connection_id = ? ORDER BY ts ASC')
    .all(connectionId)
    .map((r) => ({
      id: r.id,
      name: r.name,
      config: safeJson(r.config) || { variables: [], widgets: [] },
      folderId: r.folder_id || null,
      ts: r.ts,
    }))

  const schedule = getBackupSchedule(connectionId)
  const backupSchedule = schedule ? (({ connectionId: _c, ...rest }) => rest)(schedule) : null

  return {
    kind: 'connection',
    version: CONNECTION_EXPORT_VERSION,
    exportedAt: Date.now(),
    app: { name: APP_NAME, version: APP_VERSION },
    includesSecrets: !!includeSecrets,
    connection: { type, name, environment: environment || null, folder: folder || '', tags: tags || [], settings },
    folders,
    tableFolders,
    savedQueries,
    workflows,
    dashboards,
    backupSchedule,
  }
}

// Writes the connection's export document to a temp file so it can ride the same
// upload path as a database dump. Never carries secrets: the file lands in
// object storage and may sit there for years — restoring it means re-entering
// the password. Output: { filePath, sizeBytes }.
export async function exportConnectionConfigToFile(conn) {
  const doc = buildConnectionExport(conn.id, { includeSecrets: false })
  if (!doc) throw new Error('Connection not found')
  const filePath = path.join(BACKUP_TMP_DIR, `${randomUUID()}.connection.json`)
  await fs.promises.writeFile(filePath, JSON.stringify(doc, null, 2))
  return { filePath, sizeBytes: fs.statSync(filePath).size }
}

// Re-id an exported folder tree: every folder gets a fresh id, parents are
// remapped, and anything that would cycle or bust the per-type depth cap is
// reparented to the root (a hand-edited file shouldn't be able to corrupt the tree).
function remapFolders(rawFolders, warnings) {
  const list = (Array.isArray(rawFolders) ? rawFolders : []).filter((f) => f && typeof f.name === 'string' && f.name.trim())
  const idMap = new Map()
  for (const f of list) idMap.set(f.id, randomUUID())
  const parentOf = new Map(list.map((f) => [f.id, f.parentId || null]))
  const typeOf = new Map(list.map((f) => [f.id, folderTypeOf(f.type)]))

  // Depth walked over the *exported* ids (root folder = 1); a cycle returns Infinity.
  const depthOf = (fid) => {
    let depth = 0
    let cur = fid
    const seen = new Set()
    while (cur) {
      if (seen.has(cur)) return Infinity
      seen.add(cur)
      depth++
      cur = parentOf.get(cur) || null
    }
    return depth
  }

  return {
    idMap,
    typeByOldId: typeOf,
    rows: list.map((f) => {
      const type = typeOf.get(f.id)
      let parentId = f.parentId || null
      // A parent of a different type (or missing) is not a valid parent.
      if (parentId && (!idMap.has(parentId) || typeOf.get(parentId) !== type)) parentId = null
      if (parentId && depthOf(f.id) > FOLDER_TYPES[type].maxDepth) {
        warnings.push(`Folder "${f.name}" was nested too deep and was imported at the root.`)
        parentId = null
      }
      return {
        id: idMap.get(f.id),
        type,
        name: f.name.trim(),
        color: f.color || null,
        parentId: parentId ? idMap.get(parentId) : null,
        ts: Number(f.ts) || Date.now(),
      }
    }),
  }
}

// Deep-replace every string that is exactly an exported workflow id with the
// id its import created — this is what keeps dashboard row-action buttons
// (`rowActions[].workflowId`) wired to the right workflow.
function remapIdsDeep(value, idMap) {
  if (typeof value === 'string') return idMap.get(value) || value
  if (Array.isArray(value)) return value.map((v) => remapIdsDeep(v, idMap))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remapIdsDeep(v, idMap)]))
  }
  return value
}

// Create a connection (plus all its artifacts) from an export document. Runs in
// one transaction: a rejected document leaves nothing behind. Returns the new
// connection with a per-artifact count and any warnings worth surfacing.
export function importConnectionDoc(doc, { workspaceId, ownerId, name, settings: settingsOverride }) {
  if (!doc || doc.kind !== 'connection') throw Object.assign(new Error('Not a connection export file.'), { status: 400 })
  if (Number(doc.version) > CONNECTION_EXPORT_VERSION)
    throw Object.assign(new Error(`This file was exported by a newer version of ${APP_NAME}.`), { status: 400 })
  const src = doc.connection
  if (!src || typeof src.type !== 'string' || !src.type.trim())
    throw Object.assign(new Error('The file is missing its connection settings.'), { status: 400 })

  const warnings = []
  const connectionId = randomUUID()
  const connName = (name || src.name || 'Imported connection').trim()

  // Storage destinations are workspace-scoped and are NOT part of the bundle —
  // references to ones this workspace doesn't have are dropped, not invented.
  const knownDestinations = new Set([LOCAL_STORAGE_ID, ...listStorageRows(workspaceId).map((d) => d.id)])
  const keepDestinations = (ids, label) => {
    const list = (Array.isArray(ids) ? ids : []).filter((d) => typeof d === 'string')
    const kept = list.filter((d) => knownDestinations.has(d))
    if (kept.length < list.length) warnings.push(`${label} referenced a storage destination this workspace doesn't have; it was removed.`)
    return kept
  }

  const { idMap: folderIds, typeByOldId, rows: folderRows } = remapFolders(doc.folders, warnings)
  // Only accept an item's folder when it exists *and* groups that kind of item.
  const folderFor = (oldId, type) => (oldId && folderIds.has(oldId) && typeByOldId.get(oldId) === type ? folderIds.get(oldId) : null)

  const workflowIds = new Map()
  for (const w of Array.isArray(doc.workflows) ? doc.workflows : []) if (w?.id) workflowIds.set(w.id, randomUUID())

  const counts = { folders: folderRows.length, tables: 0, savedQueries: 0, workflows: 0, dashboards: 0 }

  const tx = meta.transaction(() => {
    saveConnection({
      ...(src.settings && typeof src.settings === 'object' ? src.settings : {}),
      ...(settingsOverride && typeof settingsOverride === 'object' ? settingsOverride : {}),
      id: connectionId,
      type: src.type,
      name: connName,
      workspaceId,
      ownerId,
      environment: src.environment || null,
      folder: src.folder || '',
      tags: Array.isArray(src.tags) ? src.tags : [],
      schemaVersion: 1,
    })

    const insFolder = meta.prepare('INSERT INTO folders (id, connection_id, type, name, color, parent_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const f of folderRows) insFolder.run(f.id, connectionId, f.type, f.name, f.color, f.parentId, f.ts)

    const insTable = meta.prepare('INSERT INTO connection_tables (id, connection_id, table_name, folder_id, ts) VALUES (?, ?, ?, ?, ?)')
    for (const t of Array.isArray(doc.tableFolders) ? doc.tableFolders : []) {
      const fid = folderFor(t?.folderId, 'table')
      if (!t?.tableName || !fid) continue
      insTable.run(randomUUID(), connectionId, String(t.tableName), fid, Date.now())
      counts.tables++
    }

    const insQuery = meta.prepare(
      'INSERT INTO saved_queries (id, connection_id, name, sql, kind, folder_id, layout, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (const q of Array.isArray(doc.savedQueries) ? doc.savedQueries : []) {
      if (!q?.name?.trim() || !q?.sql?.trim()) continue
      const layout = q.layout && typeof q.layout === 'object' && !Array.isArray(q.layout) ? JSON.stringify(q.layout) : null
      insQuery.run(
        randomUUID(),
        connectionId,
        q.name.trim(),
        q.sql.trim(),
        q.kind || 'query',
        folderFor(q.folderId, 'query'),
        layout,
        Number(q.ts) || Date.now()
      )
      counts.savedQueries++
    }

    // Schedules are imported paused: an import shouldn't silently start firing
    // jobs (or backups) against a database the user hasn't verified yet.
    const insWorkflow = meta.prepare(
      'INSERT INTO workflows (id, connection_id, name, graph, folder_id, schedule_enabled, next_run_at, ts) VALUES (?, ?, ?, ?, ?, 0, NULL, ?)'
    )
    let pausedWorkflows = 0
    for (const w of Array.isArray(doc.workflows) ? doc.workflows : []) {
      if (!w?.name?.trim() || !workflowIds.has(w.id)) continue
      const nodes = (w.graph?.nodes || []).map((n) => {
        if (n?.type === 'webhook') return { ...n, data: { ...(n.data || {}), token: mintWebhookToken() } }
        if (n?.type === 'storage')
          return { ...n, data: { ...(n.data || {}), destinationIds: keepDestinations(n.data?.destinationIds, `Workflow "${w.name}"`) } }
        return n
      })
      if (w.scheduleEnabled) pausedWorkflows++
      insWorkflow.run(
        workflowIds.get(w.id),
        connectionId,
        w.name.trim(),
        JSON.stringify({ nodes, edges: w.graph?.edges || [] }),
        folderFor(w.folderId, 'workflow'),
        Number(w.ts) || Date.now()
      )
      counts.workflows++
    }
    if (pausedWorkflows) warnings.push(`${pausedWorkflows} scheduled workflow(s) were imported paused — enable them once the connection is verified.`)

    const insDashboard = meta.prepare('INSERT INTO dashboards (id, connection_id, name, config, folder_id, ts) VALUES (?, ?, ?, ?, ?, ?)')
    for (const d of Array.isArray(doc.dashboards) ? doc.dashboards : []) {
      if (!d?.name?.trim()) continue
      const config = remapIdsDeep(d.config && typeof d.config === 'object' ? d.config : { variables: [], widgets: [] }, workflowIds)
      insDashboard.run(randomUUID(), connectionId, d.name.trim(), JSON.stringify(config), folderFor(d.folderId, 'dashboard'), Number(d.ts) || Date.now())
      counts.dashboards++
    }

    const bs = doc.backupSchedule
    if (bs && typeof bs === 'object' && bs.frequency) {
      createSchedule(
        connectionId,
        { ...bs, destinationIds: keepDestinations(bs.destinationIds, 'The backup schedule') },
        { paused: true }
      )
      warnings.push('The backup schedule was imported paused — review its destinations, then activate it.')
    }
  })
  tx()

  return { connection: getConnection(connectionId), counts, warnings }
}
