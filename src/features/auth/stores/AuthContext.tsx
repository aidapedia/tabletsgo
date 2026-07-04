import { createContext, useContext, useEffect, useState } from 'react'
import { request, TOKEN_KEY } from '@/shared/api/request'
import { useToast } from '@/shared/ui/feedback/Toast'

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
  const toast = useToast()

  // Raised by the request wrapper when a call comes back 401 with a token
  // attached — the session has expired or been revoked server-side. Sign out
  // locally so RequireAuth redirects to /login.
  useEffect(() => {
    const onUnauthorized = () => {
      clear()
      setUser(null)
      toast?.info('Your session has expired. Please log in again.')
    }
    window.addEventListener('auth:unauthorized', onUnauthorized)
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized)
  }, [toast])

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
