import { request, safeRequest } from '@/shared/api/request'

// First-run status — whether the setup wizard should be shown.
export async function getSetupStatus() {
  return safeRequest<{ needsSetup: boolean }>('/setup', { needsSetup: false })
}

// Create the admin account + first workspace. Returns { user, token }.
export async function submitSetup(payload: { email: string; password: string; name?: string; workspace: string }) {
  return request('/setup', { method: 'POST', body: payload })
}

// Invite-acceptance flow (used by the accept-invite page in a later phase).
export async function getInvite(token: string) {
  return request(`/invite/${encodeURIComponent(token)}`)
}
export async function acceptInvite(token: string, payload: { name: string; password: string }) {
  return request(`/invite/${encodeURIComponent(token)}/accept`, { method: 'POST', body: payload })
}

// Password reset. `forgotPassword` always resolves (never reveals if the email
// exists); the link is emailed. Reset validates the token then sets a password.
export async function forgotPassword(email: string) {
  return request('/auth/forgot', { method: 'POST', body: { email } })
}
export async function getReset(token: string) {
  return request<{ email: string }>(`/auth/reset/${encodeURIComponent(token)}`)
}
export async function resetPassword(token: string, password: string) {
  return request(`/auth/reset/${encodeURIComponent(token)}`, { method: 'POST', body: { password } })
}
