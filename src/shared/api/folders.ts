// Generic, per-connection folders — one polymorphic tree per resource `type`
// ('query' groups saved queries, 'dashboard' groups dashboards, 'workflow'
// groups workflows, 'table' groups the connected database's tables). Backed by
// the single `folders` table on the server; features wrap these with their own
// type bound (see workspace/lib/savedQueries.ts, dashboard/lib/api.ts,
// workflow/lib/api.ts and table-folders/lib/api.ts).
// Reads degrade quietly; mutations throw (caller try/catches + toasts).

import { request, safeRequest } from '@/shared/api/request'

export type FolderType = 'query' | 'dashboard' | 'workflow' | 'table'
export type Folder = {
  id: string
  name: string
  color: string | null // optional accent color (nullable for every type)
  parentId: string | null
  type: FolderType
  ts: number
  tables?: string[] // type='table' only: the table names grouped in this folder
}

export async function fetchFolders(connectionId: string, type: FolderType): Promise<Folder[]> {
  if (!connectionId) return []
  return safeRequest(`/connections/${connectionId}/folders?type=${type}`, [])
}

export async function createFolder(
  connectionId: string,
  type: FolderType,
  name: string,
  parentId: string | null = null,
  color: string | null = null
): Promise<Folder> {
  return request(`/connections/${connectionId}/folders`, {
    method: 'POST',
    body: { type, name, parentId: parentId || null, color: color || null },
  })
}

// Patch a folder: any subset of name / color / parentId (parentId null = root).
export async function updateFolder(
  connectionId: string,
  folderId: string,
  fields: { name?: string; color?: string | null; parentId?: string | null }
): Promise<void> {
  await request(`/connections/${connectionId}/folders/${folderId}`, { method: 'PUT', body: fields })
}

export async function renameFolder(connectionId: string, folderId: string, name: string): Promise<void> {
  await updateFolder(connectionId, folderId, { name })
}

// Move a folder under a new parent (null = root). Nesting builds subdirectories.
export async function moveFolder(connectionId: string, folderId: string, parentId: string | null): Promise<void> {
  await updateFolder(connectionId, folderId, { parentId: parentId || null })
}

export async function deleteFolder(connectionId: string, folderId: string): Promise<void> {
  await request(`/connections/${connectionId}/folders/${folderId}`, { method: 'DELETE' })
}

// Put a table in a folder, or ungroup it with `folderId: null`. Tables live in
// the user's database, so membership is keyed by plain table name (one folder
// per table) — it's stored on the server's per-table `connection_tables` row.
export async function setTableFolder(connectionId: string, table: string, folderId: string | null): Promise<void> {
  await request(`/connections/${connectionId}/tables/${encodeURIComponent(table)}/folder`, {
    method: 'PUT',
    body: { folderId },
  })
}
