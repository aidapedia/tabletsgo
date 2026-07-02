import { createContext, useContext, useEffect, useState } from 'react'
import { request, safeRequest } from '@/shared/api/request'

const ConnectionsContext = createContext(null)

export function ConnectionsProvider({ children }) {
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(true)

  // Load connections from backend — the list reflects exactly what the server returns.
  useEffect(() => {
    safeRequest('/connections', []).then(setConnections).finally(() => setLoading(false))
  }, [])

  const addConnection = async (conn) => {
    try {
      const newConn = await request('/connections', { method: 'POST', body: conn })
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
