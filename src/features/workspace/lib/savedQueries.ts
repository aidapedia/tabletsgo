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
// Query folders are the generic, polymorphic folders (shared/api/folders) bound
// to type='query'. Re-exported here with the queries feature's signatures so
// callers don't need to know about the discriminator.

import * as folders from '@/shared/api/folders'

export function fetchFolders(connectionId) {
  return folders.fetchFolders(connectionId, 'query')
}

export function createFolder(connectionId, name, parentId = null) {
  return folders.createFolder(connectionId, 'query', name, parentId)
}

export function renameFolder(connectionId, folderId, name) {
  return folders.renameFolder(connectionId, folderId, name)
}

// Move a folder under a new parent (null = root). Nesting builds subdirectories.
export function moveFolder(connectionId, folderId, parentId) {
  return folders.moveFolder(connectionId, folderId, parentId)
}

export function deleteFolder(connectionId, folderId) {
  return folders.deleteFolder(connectionId, folderId)
}
