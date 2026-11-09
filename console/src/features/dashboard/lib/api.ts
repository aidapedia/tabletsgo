// Per-connection dashboards, persisted on the backend. Mirrors the workflows
// client (features/workflow/lib/api.ts) — reads degrade quietly, mutations throw.

import { request, safeRequest } from '@/shared/api/request'
import * as folders from '@/shared/api/folders'
import type { Dashboard, DashboardConfig, DashboardFolder, DashboardSummary, WorkspaceDashboard } from '../types'

export async function listDashboards(connectionId: string): Promise<DashboardSummary[]> {
  if (!connectionId) return []
  return safeRequest(`/connections/${connectionId}/dashboards`, [])
}

// Every dashboard in a workspace the caller can reach — one request rather than
// one per connection. The server filters by connection access, so this is never
// wider than listDashboards() would be, connection by connection.
export async function listWorkspaceDashboards(workspaceId: string): Promise<WorkspaceDashboard[]> {
  if (!workspaceId) return []
  return safeRequest(`/workspaces/${workspaceId}/dashboards`, [])
}

export async function getDashboard(connectionId: string, did: string): Promise<Dashboard> {
  return request(`/connections/${connectionId}/dashboards/${did}`)
}

// `config` is optional — passed when importing a JSON export as a new dashboard.
// `folderId` (optional) creates the dashboard inside a folder.
export async function createDashboard(
  connectionId: string,
  name: string,
  config?: DashboardConfig,
  folderId?: string | null
): Promise<Dashboard> {
  return request(`/connections/${connectionId}/dashboards`, { method: 'POST', body: { name, config, folderId: folderId || null } })
}

export async function updateDashboard(
  connectionId: string,
  did: string,
  fields: { name?: string; config?: DashboardConfig; folderId?: string | null }
): Promise<void> {
  await request(`/connections/${connectionId}/dashboards/${did}`, { method: 'PUT', body: fields })
}

export async function deleteDashboard(connectionId: string, did: string): Promise<void> {
  await request(`/connections/${connectionId}/dashboards/${did}`, { method: 'DELETE' })
}

// ---- Dashboard folders (nesting capped at 3 levels, enforced server-side) ----
// The generic, polymorphic folders (shared/api/folders) bound to type='dashboard'.

export function fetchDashboardFolders(connectionId: string): Promise<DashboardFolder[]> {
  return folders.fetchFolders(connectionId, 'dashboard')
}

export function createDashboardFolder(
  connectionId: string,
  name: string,
  parentId: string | null = null
): Promise<DashboardFolder> {
  return folders.createFolder(connectionId, 'dashboard', name, parentId)
}

export function renameDashboardFolder(connectionId: string, folderId: string, name: string): Promise<void> {
  return folders.renameFolder(connectionId, folderId, name)
}

// Move a folder under a new parent (null = root). Nesting builds subdirectories.
export function moveDashboardFolder(connectionId: string, folderId: string, parentId: string | null): Promise<void> {
  return folders.moveFolder(connectionId, folderId, parentId)
}

export function deleteDashboardFolder(connectionId: string, folderId: string): Promise<void> {
  return folders.deleteFolder(connectionId, folderId)
}
