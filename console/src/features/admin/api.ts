import { request, safeRequest } from '@/shared/api/request'

/**
 * Instance administration — the `/api/admin/*` surface, open only to whoever
 * holds tabletsgo's admin role at Hayat's root. Only the mail server is left
 * here; accounts and workspaces are Hayat's.
 */
export type GlobalSmtp = {
  host: string
  port: string | number
  secure: boolean
  user: string
  from: string
  hasPassword: boolean
}

// `env` is the layer underneath — non-secret, and null when SMTP_HOST is unset.
export type GlobalSmtpInfo = {
  smtp: GlobalSmtp
  env: { host: string; port: string; secure: boolean; user: string; from: string } | null
}

export async function getGlobalSmtp() {
  return request<GlobalSmtpInfo>('/admin/smtp')
}

// Omit `pass` to keep the stored password; `null` clears it.
export async function updateGlobalSmtp(body: {
  host?: string
  port?: number
  secure?: boolean
  user?: string
  from?: string
  pass?: string | null
}) {
  return request<{ smtp: GlobalSmtp }>('/admin/smtp', { method: 'PUT', body })
}

// Drop the global config — the instance falls back to the env vars, if any.
export async function clearGlobalSmtp() {
  return request<{ ok: true; smtp: GlobalSmtp }>('/admin/smtp', { method: 'DELETE' })
}

export async function testGlobalSmtp(body: { to?: string; smtp?: any }) {
  return request<{ ok: true }>('/admin/smtp/test', { method: 'POST', body })
}

// ---- Sign-in providers ----
