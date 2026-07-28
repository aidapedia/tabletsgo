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
  useEffect(() => {
    if (!currentId) {
      setConnections([])
      setLoading(false)
      return
    }
    setLoading(true)
    safeRequest(`/connections?workspace=${currentId}`, [])
      .then(setConnections)
      .finally(() => setLoading(false))
  }, [currentId])

  const addConnection = async (conn) => {
    try {
      const newConn = await request('/connections', { method: 'POST', body: { ...conn, workspaceId: currentId } })
      setConnections((prev) => [...prev, newConn])
      return newConn
    } catch (error) {
      console.error('Failed to add connection:', error)
    }
  }

  const updateConnection = async (id, patch) => {
    try {
      const updated = await request(`/connections/${id}`, { method: 'PUT', body: patch })
      setConnections((prev) => prev.map((c) => (c.id === id ? updated : c)))
      return updated
    } catch (error) {
      console.error('Failed to update connection:', error)
    }
  }

  // Create a connection (plus its folders/queries/workflows/dashboards) from an
  // export document. Unlike the CRUD helpers above this one *throws* — the
  // import dialog needs the server's message to show what went wrong.
  const importConnection = async ({ document, name, settings }) => {
    const result = await importConnectionDoc({ workspaceId: currentId, document, name, settings })
    setConnections((prev) => [...prev, result.connection])
    return result
  }

  const removeConnection = async (id) => {
    try {
      await request(`/connections/${id}`, { method: 'DELETE' })
      setConnections((prev) => prev.filter((c) => c.id !== id))
      return true
    } catch (error) {
      console.error('Failed to remove connection:', error)
    }
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
      value={{ connections, loading, addConnection, updateConnection, importConnection, removeConnection, testConnection, patchLocalConnection }}
    >
      {children}
    </ConnectionsContext.Provider>
  )
}

export const useConnections = () => useContext(ConnectionsContext)
