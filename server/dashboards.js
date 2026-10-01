/** Dashboard records in the app metadata store. The config remains an opaque
 * document: widgets may query any engine supported by the database layer. */

import { randomUUID } from 'crypto'
import { meta } from './meta.js'
import { safeJson } from './util.js'

const invalid = (message) => Object.assign(new Error(message), { status: 400 })
const emptyConfig = () => ({ variables: [], widgets: [] })

const validFolder = (connectionId, folderId) =>
  !folderId || !!meta.prepare("SELECT 1 FROM folders WHERE id = ? AND connection_id = ? AND type = 'dashboard'").get(folderId, connectionId)

export function listDashboards(connectionId) {
  return meta.prepare('SELECT id, name, folder_id, ts FROM dashboards WHERE connection_id = ? ORDER BY ts DESC')
    .all(connectionId)
    .map((r) => ({ id: r.id, name: r.name, folderId: r.folder_id || null, ts: r.ts }))
}

export function listDashboardsForConnections(connections) {
  if (!connections.length) return []
  const byId = new Map(connections.map((conn) => [conn.id, conn]))
  const ids = [...byId.keys()]
  const rows = meta.prepare(
    `SELECT id, connection_id, name, config, folder_id, ts FROM dashboards
     WHERE connection_id IN (${ids.map(() => '?').join(', ')}) ORDER BY ts DESC`
  ).all(...ids)
  return rows.map((row) => {
    const conn = byId.get(row.connection_id)
    const config = safeJson(row.config) || {}
    return {
      id: row.id,
      connectionId: row.connection_id,
      connectionName: conn.name,
      connectionType: conn.type,
      name: row.name,
      ts: row.ts,
      folderId: row.folder_id || null,
      widgetCount: Array.isArray(config.widgets) ? config.widgets.length : 0,
      variableCount: Array.isArray(config.variables) ? config.variables.length : 0,
    }
  })
}

export function createDashboard(connectionId, body = {}) {
  if (typeof body.name !== 'string' || !body.name.trim()) throw invalid('A dashboard name is required')
  if (!validFolder(connectionId, body.folderId)) throw invalid('Folder not found')
  const entry = {
    id: randomUUID(),
    name: body.name.trim(),
    config: body.config && typeof body.config === 'object' ? body.config : emptyConfig(),
    folderId: body.folderId || null,
    ts: Date.now(),
  }
  meta.prepare('INSERT INTO dashboards (id, connection_id, name, config, folder_id, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .run(entry.id, connectionId, entry.name, JSON.stringify(entry.config), entry.folderId, entry.ts)
  return entry
}

export function getDashboard(connectionId, dashboardId) {
  const row = meta.prepare('SELECT id, name, config, ts FROM dashboards WHERE id = ? AND connection_id = ?')
    .get(dashboardId, connectionId)
  return row && { id: row.id, name: row.name, ts: row.ts, config: safeJson(row.config) || emptyConfig() }
}

export function updateDashboard(connectionId, dashboardId, body = {}) {
  const sets = []
  const vals = []
  if (body.name != null) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw invalid('A name is required')
    sets.push('name = ?')
    vals.push(body.name.trim())
  }
  if (body.config != null) {
    if (typeof body.config !== 'object') throw invalid('config must be an object')
    sets.push('config = ?')
    vals.push(JSON.stringify(body.config))
  }
  if ('folderId' in body) {
    const folderId = body.folderId || null
    if (!validFolder(connectionId, folderId)) throw invalid('Folder not found')
    sets.push('folder_id = ?')
    vals.push(folderId)
  }
  if (!sets.length) throw invalid('Nothing to update')
  return !!meta.prepare(`UPDATE dashboards SET ${sets.join(', ')} WHERE id = ? AND connection_id = ?`)
    .run(...vals, dashboardId, connectionId).changes
}

export function deleteDashboard(connectionId, dashboardId) {
  return !!meta.prepare('DELETE FROM dashboards WHERE id = ? AND connection_id = ?')
    .run(dashboardId, connectionId).changes
}
