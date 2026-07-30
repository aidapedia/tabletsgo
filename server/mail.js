/**
 * Outbound email. SMTP is optional everywhere: a workspace's own settings win,
 * the Docker env vars are the fallback, and with neither configured the caller
 * degrades gracefully (invites still return a copyable link).
 */

import nodemailer from 'nodemailer'
import { meta } from './meta.js'

// Nodemailer's defaults (2min connect/socket timeout) make a bad host hang
// the request for minutes instead of failing fast — cap it well below that.
const SMTP_TIMEOUTS = { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 }

// Resolve SMTP config from the workspace settings row, falling back to Docker
// env. Returns null when no host is configured anywhere.
export const smtpConfig = (wsRow) => {
  let ws = {}
  try {
    ws = JSON.parse(wsRow?.settings || '{}').smtp || {}
  } catch {
    ws = {}
  }
  const host = ws.host || process.env.SMTP_HOST
  if (!host) return null
  const user = ws.user || process.env.SMTP_USER || ''
  return {
    host,
    port: Number(ws.port || process.env.SMTP_PORT || 587),
    secure: ws.secure ?? process.env.SMTP_SECURE === 'true',
    user,
    pass: ws.pass || process.env.SMTP_PASS || '',
    from: ws.from || process.env.SMTP_FROM || user || 'no-reply@tabletsgo.local',
  }
}

// SMTP usable for an app-level email to a user (password reset): env first,
// then any of the user's workspaces that has SMTP configured.
export const smtpForUser = (userId) => {
  const envCfg = smtpConfig(null)
  if (envCfg) return envCfg
  const rows = meta
    .prepare('SELECT w.settings FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE m.user_id = ?')
    .all(userId)
  for (const r of rows) {
    const cfg = smtpConfig(r)
    if (cfg) return cfg
  }
  return null
}

// Generic send. `cfg` from smtpConfig(); `message` is { to, subject, text, html }.
export const sendMail = async (cfg, message) => {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    ...SMTP_TIMEOUTS,
  })
  await transport.sendMail({ from: cfg.from, ...message })
}

export const sendInviteEmail = (cfg, { to, workspaceName, link }) =>
  sendMail(cfg, {
    to,
    subject: `You've been invited to ${workspaceName} on Tabletsgo`,
    text: `You've been invited to join ${workspaceName} on Tabletsgo. Set your password: ${link}`,
    html: `<p>You've been invited to join <b>${workspaceName}</b> on Tabletsgo.</p><p><a href="${link}">Accept your invite &amp; set a password</a></p><p style="color:#888">Or paste this link into your browser: ${link}</p>`,
  })

export const sendResetEmail = (cfg, { to, link }) =>
  sendMail(cfg, {
    to,
    subject: 'Reset your Tabletsgo password',
    text: `Reset your Tabletsgo password: ${link}\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
    html: `<p>We received a request to reset your Tabletsgo password.</p><p><a href="${link}">Reset your password</a></p><p style="color:#888">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>`,
  })
