// Per-connection named saved queries, persisted on the backend.

import { request, safeRequest } from '@/shared/api/request'

export async function fetchSaved(connectionId) {
  if (!connectionId) return []
  return safeRequest(`/connections/${connectionId}/saved`, [])
}

export async function createSaved(connectionId, { name, sql, kind }: any) {
  return request(`/connections/${connectionId}/saved`, { method: 'POST', body: { name, sql, kind } })
}

export async function renameSaved(connectionId, savedId, name) {
  await request(`/connections/${connectionId}/saved/${savedId}`, { method: 'PUT', body: { name } })
}

// Update an existing saved query's fields (e.g. { sql } or { name }).
export async function updateSaved(connectionId, savedId, fields) {
  await request(`/connections/${connectionId}/saved/${savedId}`, { method: 'PUT', body: fields })
}

export async function deleteSaved(connectionId, savedId) {
  await request(`/connections/${connectionId}/saved/${savedId}`, { method: 'DELETE' })
}

// ---- Folders ----

export async function fetchFolders(connectionId) {
  if (!connectionId) return []
  return safeRequest(`/connections/${connectionId}/folders`, [])
}

export async function createFolder(connectionId, name, parentId = null) {
  return request(`/connections/${connectionId}/folders`, { method: 'POST', body: { name, parentId: parentId || null } })
}

export async function renameFolder(connectionId, folderId, name) {
  await request(`/connections/${connectionId}/folders/${folderId}`, { method: 'PUT', body: { name } })
}

// Move a folder under a new parent (null = root). Nesting builds subdirectories.
export async function moveFolder(connectionId, folderId, parentId) {
  await request(`/connections/${connectionId}/folders/${folderId}`, { method: 'PUT', body: { parentId: parentId || null } })
}

export async function deleteFolder(connectionId, folderId) {
  await request(`/connections/${connectionId}/folders/${folderId}`, { method: 'DELETE' })
}
