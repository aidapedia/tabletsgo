import { request } from '@/shared/api/request'

// Where the browser signs in. Public: asked before anyone is signed in.
export type AuthConfig = { issuer: string | null; clientId: string | null; consoleUrl: string | null }

export type AuthUser = {
  id: string
  email: string
  name: string
  // 'admin' = holds tabletsgo's admin role at Hayat's root.
  role: 'admin' | 'user'
  timezone: string | null
  picture: string | null
}

export async function getAuthConfig() {
  return request<AuthConfig>('/auth/config')
}

// The caller as Hayat knows them, and where they manage their own account.
export async function getMe() {
  return request<{ user: AuthUser; accountUrl: string | null }>('/auth/me')
}
