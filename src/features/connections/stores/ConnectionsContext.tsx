import { createContext, useContext, useEffect, useState } from 'react'
import { request, safeRequest } from '@/shared/api/request'
import { useWorkspaces } from '@/features/workspaces'

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

  return (
    <ConnectionsContext.Provider
      value={{ connections, loading, addConnection, updateConnection, removeConnection, testConnection }}
    >
      {children}
    </ConnectionsContext.Provider>
  )
}

export const useConnections = () => useContext(ConnectionsContext)
