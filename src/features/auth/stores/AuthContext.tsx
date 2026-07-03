import { createContext, useContext, useState } from 'react'
import { request, TOKEN_KEY } from '@/shared/api/request'

const AuthContext = createContext(null)

const STORAGE_KEY = 'dbm.auth'

// Persist the authenticated user + session token. The token lives under
// TOKEN_KEY so the shared request wrapper can attach it to every call.
const persist = (user, token) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  localStorage.setItem(TOKEN_KEY, token)
}
const clear = () => {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(TOKEN_KEY)
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null
    } catch {
      return null
    }
  })

  const login = async (email, password) => {
    const { user: u, token } = await request('/auth/login', { method: 'POST', body: { username: email, password } })
    persist(u, token)
    setUser(u)
    return u
  }

  // Called after setup / accept-invite, which return the same { user, token }.
  const authenticate = (u, token) => {
    persist(u, token)
    setUser(u)
    return u
  }

  const logout = async () => {
    try {
      await request('/auth/logout', { method: 'POST' })
    } catch {
      /* ignore — clear locally regardless */
    }
    clear()
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, login, authenticate, logout }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
