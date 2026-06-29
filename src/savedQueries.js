// Per-connection named saved queries, persisted on the backend.

const API_URL = '/api'

export async function fetchSaved(connectionId) {
  if (!connectionId) return []
  try {
    const res = await fetch(`${API_URL}/connections/${connectionId}/saved`)
    if (res.ok) return await res.json()
  } catch (error) {
    console.error('Failed to load saved queries:', error)
  }
  return []
}

export async function createSaved(connectionId, { name, sql, kind }) {
  const res = await fetch(`${API_URL}/connections/${connectionId}/saved`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, sql, kind }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to save query')
  return data
}

export async function renameSaved(connectionId, savedId, name) {
  const res = await fetch(`${API_URL}/connections/${connectionId}/saved/${savedId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Rename failed (HTTP ${res.status})`)
  }
}

export async function deleteSaved(connectionId, savedId) {
  await fetch(`${API_URL}/connections/${connectionId}/saved/${savedId}`, { method: 'DELETE' })
}
