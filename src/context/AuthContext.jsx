import { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

// Demo admin credentials. In a real app this would hit a backend.
const ADMIN = { username: 'admin', password: 'admin123' }
const STORAGE_KEY = 'dbm.auth'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null
    } catch {
      return null
    }
  })

  const login = (username, password) =>
    new Promise((resolve, reject) => {
      // Simulate a network round-trip.
      setTimeout(() => {
        if (username === ADMIN.username && password === ADMIN.password) {
          const u = { username, role: 'admin', name: 'Admin' }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
          setUser(u)
          resolve(u)
        } else {
          reject(new Error('Invalid username or password'))
        }
      }, 500)
    })

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
