// Per-connection query execution history, persisted on the backend.

const API_URL = '/api'

export async function fetchHistory(connectionId) {
  if (!connectionId) return []
  try {
    const res = await fetch(`${API_URL}/connections/${connectionId}/history`)
    if (res.ok) return await res.json()
  } catch (error) {
    console.error('Failed to load query history:', error)
  }
  return []
}

// Record one execution. Fire-and-forget — failures here must never block the
// query flow, so errors are swallowed (logged only).
export async function recordHistory(connectionId, entry) {
  if (!connectionId) return null
  try {
    const res = await fetch(`${API_URL}/connections/${connectionId}/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    })
    if (res.ok) return await res.json()
  } catch (error) {
    console.error('Failed to record query history:', error)
  }
  return null
}

// Delete specific entries (pass ids) or, with no ids, clear the whole history.
export async function deleteHistory(connectionId, ids) {
  try {
    await fetch(`${API_URL}/connections/${connectionId}/history`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids?.length ? { ids } : {}),
    })
  } catch (error) {
    console.error('Failed to delete query history:', error)
  }
}

export const clearHistory = (connectionId) => deleteHistory(connectionId)
