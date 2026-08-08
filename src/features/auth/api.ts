import { request, safeRequest } from '@/shared/api/request'

// First-run status. `needsSetup` is "this instance has no administrator" — not
// "it has no users": an install migrated from before the system role existed has
// accounts but nobody who can reach the admin area. `hasUsers` separates the two,
// because the wizard asks for different things in each case.
export async function getSetupStatus() {
  return safeRequest<{ needsSetup: boolean; hasUsers: boolean }>('/setup', { needsSetup: false, hasUsers: true })
}

// Create the instance administrator — no workspace: an admin holds no workspace
// access, so the first workspace is theirs to create once signed in. On an
// instance that already has accounts the credentials must match one of them and
// that account is promoted instead. Returns { user, token }.
export async function submitSetup(payload: { email: string; password: string; name?: string }) {
  return request('/setup', { method: 'POST', body: payload })
}

// Invite-acceptance flow (used by the accept-invite page in a later phase).
export async function getInvite(token: string) {
  return request(`/invite/${encodeURIComponent(token)}`)
}
export async function acceptInvite(token: string, payload: { name: string; password: string }) {
  return request(`/invite/${encodeURIComponent(token)}/accept`, { method: 'POST', body: payload })
}

// ---- The signed-in user's own account ----
// Self-service counterparts of the admin user routes: they always act on the
// caller. Email isn't editable here — it's the sign-in identity.
export async function getMe() {
  return request<{ user: any }>('/auth/me')
}
export async function updateProfile(payload: { name: string }) {
  return request<{ user: any }>('/auth/profile', { method: 'PATCH', body: payload })
}
// Resolves to a fresh { user, token }: changing the password invalidates every
// session, so the caller must re-persist the new token to stay signed in.
export async function changePassword(payload: { currentPassword: string; newPassword: string }) {
  return request<{ user: any; token: string }>('/auth/password', { method: 'POST', body: payload })
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
