import { request } from '@/shared/api/request'

// Which mode the instance runs in and how to sign in. Public: asked before
// anyone is signed in. `people`: is there anyone but the caller to see.
export type AuthConfig =
  | { mode: 'enterprise'; issuer: string | null; clientId: string | null; consoleUrl: string | null; people: boolean; setupRequired?: undefined }
  | { mode: 'solo'; setupRequired: boolean; people: boolean; issuer?: undefined; clientId?: undefined; consoleUrl?: undefined }

export type AuthUser = {
  id: string
  email: string
  name: string
  // 'admin' = holds tabletsgo's admin role at Hayat's root (always, for solo's owner).
  role: 'admin' | 'user'
  timezone: string | null
  picture: string | null
}

export async function getAuthConfig() {
  return request<AuthConfig>('/auth/config', { auth: false })
}

// The caller, and (enterprise) where they manage their own account in Hayat.
export async function getMe() {
  return request<{ user: AuthUser; accountUrl: string | null }>('/auth/me')
}

// ---- Solo mode: the owner signs in here (the refresh token is an httpOnly cookie) ----

export type SoloTokens = { accessToken: string; expiresIn: number; user: AuthUser }
export type SoloSetupInput = { code: string; name: string; email: string; password: string; timezone: string | null }

export const soloSetup = (input: SoloSetupInput) => request<SoloTokens>('/auth/solo/setup', { method: 'POST', body: input, auth: false })

export const soloLogin = (email: string, password: string) => request<SoloTokens>('/auth/solo/login', { method: 'POST', body: { email, password }, auth: false })

export const soloRefresh = () => request<SoloTokens>('/auth/solo/refresh', { method: 'POST', auth: false })

export const soloLogout = (everywhere = false) => request<void>('/auth/solo/logout', { method: 'POST', body: { everywhere }, auth: everywhere })

export const updateSoloAccount = (patch: { name?: string; email?: string; timezone?: string | null }) =>
  request<{ user: AuthUser }>('/auth/solo/account', { method: 'PUT', body: patch })

export const changeSoloPassword = (current: string, next: string) =>
  request<SoloTokens>('/auth/solo/password', { method: 'PUT', body: { current, next } })
