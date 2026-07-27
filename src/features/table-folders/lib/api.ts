// Table folders bound to the generic per-connection folders tree (type='table').
// The list endpoint embeds each folder's table names, so one fetch drives the
// sidebar tree, the picker and the schema-diagram regions.

import { fetchFolders, createFolder, updateFolder, deleteFolder, setTableFolder } from '@/shared/api/folders'
import type { TableFolder } from '../types'

export async function fetchTableFolders(connectionId: string): Promise<TableFolder[]> {
  const list = await fetchFolders(connectionId, 'table')
  return list.map((f) => ({ ...f, tables: f.tables || [] }))
}

export async function createTableFolder(
  connectionId: string,
  { name, color, parentId }: { name: string; color?: string | null; parentId?: string | null }
): Promise<TableFolder> {
  const created = await createFolder(connectionId, 'table', name, parentId || null, color || null)
  return { ...created, tables: created.tables || [] }
}

// Patch a folder: any subset of name / color / parentId (parentId null = root).
export async function updateTableFolder(
  connectionId: string,
  folderId: string,
  fields: { name?: string; color?: string | null; parentId?: string | null }
): Promise<void> {
  await updateFolder(connectionId, folderId, fields)
}

// Deleting a folder ungroups its tables: the server reparents them to the
// folder's own parent, or drops the mapping when that parent is the root.
export async function deleteTableFolder(connectionId: string, folderId: string): Promise<void> {
  await deleteFolder(connectionId, folderId)
}

export { setTableFolder }
