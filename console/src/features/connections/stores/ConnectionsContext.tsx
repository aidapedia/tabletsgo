import { createContext, useContext, useEffect, useState } from 'react'
import { request, safeRequest } from '@/shared/api/request'
import { useWorkspaces } from '@/features/workspaces'
import { importConnection as importConnectionDoc } from '../api'

const ConnectionsContext = createContext(null)

export function ConnectionsProvider({ children }) {
  const { currentId } = useWorkspaces()
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(true)

  // Connections are scoped to the current workspace; reload when it changes.
  const reload = () => {
    if (!currentId) {
      setConnections([])
      setLoading(false)
      return
    }
    setLoading(true)
    safeRequest(`/connections?workspace=${currentId}`, [])
      .then(setConnections)
      .finally(() => setLoading(false))
  }
  useEffect(reload, [currentId])

  // The mutations below *throw* with the server's message (a 403 for a member
  // without `connections.create`, a 502 when Hayat refused the mirror, …). The
  // caller shows it — swallowing it here made a refused create look like a save
  // whose connection then never appeared in the list.
  const addConnection = async (conn) => {
    const newConn = await request('/connections', { method: 'POST', body: { ...conn, workspaceId: currentId } })
    setConnections((prev) => [...prev, newConn])
    return newConn
  }

  const updateConnection = async (id, patch) => {
    const updated = await request(`/connections/${id}`, { method: 'PUT', body: patch })
    setConnections((prev) => prev.map((c) => (c.id === id ? updated : c)))
    return updated
  }

  // Create a connection (plus its folders/queries/workflows/dashboards) from an
  // export document; throws like the helpers above.
  const importConnection = async ({ document, name, settings }) => {
    const result = await importConnectionDoc({ workspaceId: currentId, document, name, settings })
    setConnections((prev) => [...prev, result.connection])
    return result
  }

  const removeConnection = async (id) => {
    await request(`/connections/${id}`, { method: 'DELETE' })
    setConnections((prev) => prev.filter((c) => c.id !== id))
    return true
  }

  const testConnection = async (conn) => {
    try {
      return await request('/test-connection', { method: 'POST', body: conn })
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  }

  // Update local state only — for fields the server already persisted through
  // a different endpoint (e.g. schemaVersion via POST .../schema/migrations),
  // so callers don't need a redundant PUT round-trip.
  const patchLocalConnection = (id, patch) =>
    setConnections((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))

  return (
    <ConnectionsContext.Provider
      value={{ connections, loading, reload, addConnection, updateConnection, importConnection, removeConnection, testConnection, patchLocalConnection }}
    >
      {children}
    </ConnectionsContext.Provider>
  )
}

export const useConnections = () => useContext(ConnectionsContext)
