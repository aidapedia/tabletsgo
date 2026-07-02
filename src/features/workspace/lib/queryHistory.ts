// Per-connection query execution history, persisted on the backend.

import { safeRequest } from '@/shared/api/request'

export async function fetchHistory(connectionId) {
  if (!connectionId) return []
  return safeRequest(`/connections/${connectionId}/history`, [])
}

// Record one execution. Fire-and-forget — failures here must never block the
// query flow, so errors are swallowed (logged only).
export async function recordHistory(connectionId, entry) {
  if (!connectionId) return null
  return safeRequest(`/connections/${connectionId}/history`, null, { method: 'POST', body: entry })
}

// Delete specific entries (pass ids) or, with no ids, clear the whole history.
export async function deleteHistory(connectionId, ids?) {
  await safeRequest(`/connections/${connectionId}/history`, null, {
    method: 'DELETE',
    body: ids?.length ? { ids } : {},
  })
}

export const clearHistory = (connectionId) => deleteHistory(connectionId)
