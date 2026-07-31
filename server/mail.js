/**
 * Outbound email. There is exactly **one** mail server per instance, owned by
 * an instance admin (Administration → Email, `/api/admin/smtp`):
 *
 *   global (admin) settings → SMTP_* env vars
 *
 * Mail is an instance-level concern — a workspace owner has no business
 * choosing which server sends the instance's password resets — so nothing
 * below this file knows about layers or workspaces. The env vars stay readable
 * underneath the admin config so an install that has always configured SMTP
 * through docker-compose keeps working untouched. With neither configured the
 * caller degrades gracefully (invites still return a copyable link).
 */

import nodemailer from 'nodemailer'
import { globalSmtp } from './app-settings.js'

// Nodemailer's defaults (2min connect/socket timeout) make a bad host hang
// the request for minutes instead of failing fast — cap it well below that.
const SMTP_TIMEOUTS = { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 }

// The Docker env layer, or null when SMTP_HOST is unset.
export const envSmtp = () => {
  if (!process.env.SMTP_HOST) return null
  return {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || '',
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  }
}

/**
 * The mail server in effect, or null when neither layer names a host. This is
 * the one resolver — every email in the app goes through it, and no caller
 * passes a workspace, because mail isn't workspace-scoped.
 *
 * `source` says which layer answered ('global' | 'env'), which is all the UI
 * needs to explain where the settings came from.
 */
export const smtpConfig = () => {
  const global = globalSmtp()
  const env = global ? null : envSmtp()
  const cfg = global ? { source: 'global', ...global } : env ? { source: 'env', ...env } : null
  if (!cfg) return null
  const user = cfg.user || ''
  return {
    source: cfg.source,
    host: cfg.host,
    port: Number(cfg.port || 587),
    secure: !!cfg.secure,
    user,
    pass: cfg.pass || '',
    from: cfg.from || user || 'no-reply@tabletsgo.local',
  }
}

// The same config with the password stripped — what routes hand a client so a
// settings form can show what's in effect without the secret leaving the server.
export const publicSmtpConfig = () => {
  const cfg = smtpConfig()
  if (!cfg) return null
  const { pass, ...rest } = cfg
  return rest
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

// "wrong version number" is OpenSSL-speak for "the TLS mode doesn't match what
// the server expects on that port" — translate it, since the raw error is
// meaningless to anyone who isn't reading OpenSSL source.
export const describeSmtpError = (err) => {
  const raw = err?.message || 'Failed to send test email.'
  return /wrong version number/i.test(raw)
    ? "SSL/TLS handshake failed — the encryption mode probably doesn't match the port. Try switching between STARTTLS (587) and Implicit TLS/SSL (465)."
    : raw
}

// The "does this config work" probe behind both SMTP settings forms.
export const sendTestEmail = (cfg, { to, scope = 'SMTP settings' }) =>
  sendMail(cfg, {
    to,
    subject: 'Tabletsgo test email',
    text: `This is a test email from your Tabletsgo ${scope}. If you received it, the configuration works.`,
    html: `<p>This is a test email from your Tabletsgo ${scope}.</p><p>If you received it, the configuration works.</p>`,
  })

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
