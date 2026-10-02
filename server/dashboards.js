/** Dashboard records in the app metadata store. The config remains an opaque
 * document: widgets may query any engine supported by the database layer. */

import { randomUUID } from 'crypto'
import { db } from './meta.js'
import { safeJson } from './util.js'

const invalid = (message) => Object.assign(new Error(message), { status: 400 })
const emptyConfig = () => ({ variables: [], widgets: [] })

const validFolder = async (connectionId, folderId) =>
  !folderId || !!(await db().folders.findFirst({ where: { id: folderId, connection_id: connectionId, type: 'dashboard' }, select: { id: true } }))

export async function listDashboards(connectionId) {
  return (
    await db().dashboards.findMany({
      where: { connection_id: connectionId },
      select: { id: true, name: true, folder_id: true, ts: true },
      orderBy: { ts: 'desc' },
    })
  ).map((r) => ({ id: r.id, name: r.name, folderId: r.folder_id || null, ts: r.ts }))
}

export async function listDashboardsForConnections(connections) {
  if (!connections.length) return []
  const byId = new Map(connections.map((conn) => [conn.id, conn]))
  const rows = await db().dashboards.findMany({
    where: { connection_id: { in: [...byId.keys()] } },
    select: { id: true, connection_id: true, name: true, config: true, folder_id: true, ts: true },
    orderBy: { ts: 'desc' },
  })
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

export async function createDashboard(connectionId, body = {}) {
  if (typeof body.name !== 'string' || !body.name.trim()) throw invalid('A dashboard name is required')
  if (!(await validFolder(connectionId, body.folderId))) throw invalid('Folder not found')
  const entry = {
    id: randomUUID(),
    name: body.name.trim(),
    config: body.config && typeof body.config === 'object' ? body.config : emptyConfig(),
    folderId: body.folderId || null,
    ts: Date.now(),
  }
  await db().dashboards.create({
    data: { id: entry.id, connection_id: connectionId, name: entry.name, config: JSON.stringify(entry.config), folder_id: entry.folderId, ts: entry.ts },
  })
  return entry
}

export async function getDashboard(connectionId, dashboardId) {
  const row = await db().dashboards.findFirst({
    where: { id: dashboardId, connection_id: connectionId },
    select: { id: true, name: true, config: true, ts: true },
  })
  return row && { id: row.id, name: row.name, ts: row.ts, config: safeJson(row.config) || emptyConfig() }
}

export async function updateDashboard(connectionId, dashboardId, body = {}) {
  const data = {}
  if (body.name != null) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw invalid('A name is required')
    data.name = body.name.trim()
  }
  if (body.config != null) {
    if (typeof body.config !== 'object') throw invalid('config must be an object')
    data.config = JSON.stringify(body.config)
  }
  if ('folderId' in body) {
    const folderId = body.folderId || null
    if (!(await validFolder(connectionId, folderId))) throw invalid('Folder not found')
    data.folder_id = folderId
  }
  if (!Object.keys(data).length) throw invalid('Nothing to update')
  return (await db().dashboards.updateMany({ where: { id: dashboardId, connection_id: connectionId }, data })).count > 0
}

export async function deleteDashboard(connectionId, dashboardId) {
  return (await db().dashboards.deleteMany({ where: { id: dashboardId, connection_id: connectionId } })).count > 0
}
