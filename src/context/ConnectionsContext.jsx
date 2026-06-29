import { createContext, useContext, useEffect, useState } from 'react'

const ConnectionsContext = createContext(null)
const API_URL = '/api'

export function ConnectionsProvider({ children }) {
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(true)

  // Load connections from backend — the list reflects exactly what the server returns.
  useEffect(() => {
    const loadConnections = async () => {
      try {
        const res = await fetch(`${API_URL}/connections`)
        if (res.ok) setConnections(await res.json())
      } catch (error) {
        console.error('Failed to load connections:', error)
        setConnections([])
      } finally {
        setLoading(false)
      }
    }
    loadConnections()
  }, [])

  const addConnection = async (conn) => {
    try {
      const res = await fetch(`${API_URL}/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conn),
      })
      if (res.ok) {
        const newConn = await res.json()
        setConnections((prev) => [...prev, newConn])
        return newConn
      }
    } catch (error) {
      console.error('Failed to add connection:', error)
    }
  }

  const updateConnection = async (id, patch) => {
    try {
      const res = await fetch(`${API_URL}/connections/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        const updated = await res.json()
        setConnections((prev) => prev.map((c) => (c.id === id ? updated : c)))
        return updated
      }
    } catch (error) {
      console.error('Failed to update connection:', error)
    }
  }

  const removeConnection = async (id) => {
    try {
      const res = await fetch(`${API_URL}/connections/${id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setConnections((prev) => prev.filter((c) => c.id !== id))
        return true
      }
    } catch (error) {
      console.error('Failed to remove connection:', error)
    }
  }

  const testConnection = async (conn) => {
    try {
      const res = await fetch(`${API_URL}/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conn),
      })
      const data = await res.json()
      return data
    } catch (error) {
      return { ok: false, message: error.message }
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
