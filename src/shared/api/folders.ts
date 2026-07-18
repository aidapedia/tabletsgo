// Generic, per-connection folders — one polymorphic tree per resource `type`
// ('query' groups saved queries, 'dashboard' groups dashboards). Backed by the
// single `folders` table on the server; features wrap these with their own
// type bound (see workspace/lib/savedQueries.ts and dashboard/lib/api.ts).
// Reads degrade quietly; mutations throw (caller try/catches + toasts).

import { request, safeRequest } from '@/shared/api/request'

export type FolderType = 'query' | 'dashboard'
export type Folder = { id: string; name: string; parentId: string | null; type: FolderType; ts: number }

export async function fetchFolders(connectionId: string, type: FolderType): Promise<Folder[]> {
  if (!connectionId) return []
  return safeRequest(`/connections/${connectionId}/folders?type=${type}`, [])
}

export async function createFolder(
  connectionId: string,
  type: FolderType,
  name: string,
  parentId: string | null = null
): Promise<Folder> {
  return request(`/connections/${connectionId}/folders`, { method: 'POST', body: { type, name, parentId: parentId || null } })
}

export async function renameFolder(connectionId: string, folderId: string, name: string): Promise<void> {
  await request(`/connections/${connectionId}/folders/${folderId}`, { method: 'PUT', body: { name } })
}

// Move a folder under a new parent (null = root). Nesting builds subdirectories.
export async function moveFolder(connectionId: string, folderId: string, parentId: string | null): Promise<void> {
  await request(`/connections/${connectionId}/folders/${folderId}`, { method: 'PUT', body: { parentId: parentId || null } })
}

export async function deleteFolder(connectionId: string, folderId: string): Promise<void> {
  await request(`/connections/${connectionId}/folders/${folderId}`, { method: 'DELETE' })
}
