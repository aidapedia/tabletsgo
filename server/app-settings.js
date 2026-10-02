/**
 * Instance-wide settings — what an instance admin configures for the whole
 * deployment, the counterpart of a workspace's `settings` blob.
 *
 * Storage is a plain key/value table (`app_settings`, value = JSON) so a new
 * instance-wide setting is a new key, never a new table. Today there is one
 * key, 'smtp': the global mail server used whenever a workspace hasn't set its
 * own (see server/mail.js for the resolution order).
 *
 * Secrets inside a value are sealed with AES-256-GCM under their own scrypt
 * namespace, the same rule connection credentials and storage keys follow —
 * a password never sits in the DB, and never leaves the server (routes hand
 * the UI a `hasPassword` flag instead).
 */

import { db } from './meta.js'
import { safeJson } from './util.js'
import { APP_SETTINGS_KEY, decryptSecret, encryptSecret } from './crypto.js'

// ---- Generic key/value ----

export const getSetting = async (key) => {
  const row = await db().app_settings.findUnique({ where: { key } })
  return row ? safeJson(row.value) : {}
}

export const setSetting = async (key, value) => {
  const stored = { value: JSON.stringify(value || {}), updated_at: Date.now() }
  await db().app_settings.upsert({ where: { key }, create: { key, ...stored }, update: stored })
  return value
}

export const clearSetting = async (key) => {
  await db().app_settings.deleteMany({ where: { key } })
}

// ---- SMTP ----

const SMTP_KEY = 'smtp'

const decodePass = (stored) => {
  if (!stored) return ''
  try {
    return decryptSecret(stored, APP_SETTINGS_KEY)
  } catch {
    // A value sealed under a different ENCRYPTION_KEY can't be recovered;
    // treat it as "no password" rather than breaking every outgoing email.
    console.warn('Global SMTP password could not be decrypted — re-enter it in Admin → Email.')
    return ''
  }
}

/**
 * The global SMTP config with its password in the clear, or null when no host
 * is configured. Server-side only — never send this to a client.
 */
export const globalSmtp = async () => {
  const s = await getSetting(SMTP_KEY)
  if (!s.host) return null
  return {
    host: s.host,
    port: s.port || '',
    secure: !!s.secure,
    user: s.user || '',
    pass: decodePass(s.pass),
    from: s.from || '',
  }
}

/** The same config, password-masked — this is what the admin UI gets. */
export const publicGlobalSmtp = async () => {
  const s = await getSetting(SMTP_KEY)
  return {
    host: s.host || '',
    port: s.port || '',
    secure: !!s.secure,
    user: s.user || '',
    from: s.from || '',
    hasPassword: !!s.pass,
  }
}

/**
 * Merge a patch into the stored config. Fields left undefined keep their
 * stored value; an omitted/blank `pass` keeps the stored password (a save must
 * never silently wipe it), while `pass: null` clears it explicitly.
 */
export const saveGlobalSmtp = async (patch = {}) => {
  const prev = await getSetting(SMTP_KEY)
  const next = {
    host: String(patch.host ?? prev.host ?? '').trim(),
    port: patch.port ?? prev.port ?? '',
    secure: patch.secure ?? prev.secure ?? false,
    user: patch.user ?? prev.user ?? '',
    from: patch.from ?? prev.from ?? '',
    pass: patch.pass === null ? '' : patch.pass ? encryptSecret(patch.pass, APP_SETTINGS_KEY) : prev.pass || '',
  }
  await setSetting(SMTP_KEY, next)
  return publicGlobalSmtp()
}

/** Drop the global config entirely — the instance falls back to the env vars. */
export const clearGlobalSmtp = async () => clearSetting(SMTP_KEY)
