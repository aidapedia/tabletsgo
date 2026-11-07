/**
 * The Google and GitHub apps people sign in through. An instance admin sets them
 * up once, the same kind of setting as the one mail server, so they live in
 * `app_settings` the same way: the secret sealed under APP_SETTINGS_KEY and
 * never sent back to a client.
 *
 * Removing a provider's setup leaves every link in place. Links are keyed on the
 * provider's own user ids, which outlive any one app, and an account created
 * through a provider may have no other way in.
 */

import { getSetting, setSetting } from '../app-settings.js'
import { APP_SETTINGS_KEY, decryptSecret, encryptSecret } from '../crypto.js'
import { IdentityError, countLinksByProvider } from './identities.js'

const KEY = 'sign_in_providers'

export const PROVIDERS = [
  { kind: 'google', label: 'Google' },
  { kind: 'github', label: 'GitHub' },
]

export const providerLabel = (kind) => PROVIDERS.find((p) => p.kind === kind)?.label || kind

const assertKind = (kind) => {
  if (!PROVIDERS.some((p) => p.kind === kind)) throw new IdentityError('Unknown sign-in provider.', 'failed', 404)
}

const isReady = (p) => !!(p?.enabled && p.clientId && p.secret)

/** The providers people can use right now: [{ kind, label }]. */
export const enabledProviders = async () => {
  const stored = await getSetting(KEY)
  return PROVIDERS.filter((p) => isReady(stored[p.kind]))
}

/** A provider's app, secret in the clear, or null when it's off. Server-side only. */
export const providerApp = async (kind) => {
  assertKind(kind)
  const p = (await getSetting(KEY))[kind]
  if (!isReady(p)) return null
  try {
    return { clientId: p.clientId, clientSecret: decryptSecret(p.secret, APP_SETTINGS_KEY) }
  } catch {
    console.warn(`The ${providerLabel(kind)} client secret could not be decrypted — re-enter it in Admin → Sign-in.`)
    return null
  }
}

/** What the admin panel shows. Reports `hasSecret`, never the secret. */
export const adminProviders = async () => {
  const [stored, linked] = await Promise.all([getSetting(KEY), countLinksByProvider()])
  return PROVIDERS.map(({ kind, label }) => {
    const p = stored[kind] || {}
    return { kind, label, clientId: p.clientId || '', hasSecret: !!p.secret, enabled: isReady(p), linked: linked[kind] || 0 }
  })
}

/** An omitted or blank `clientSecret` keeps the saved one, like the SMTP password. */
export async function saveProvider(kind, { clientId, clientSecret, enabled } = {}) {
  assertKind(kind)
  const stored = await getSetting(KEY)
  const prev = stored[kind] || {}
  const next = {
    clientId: String(clientId ?? prev.clientId ?? '').trim(),
    secret: clientSecret ? encryptSecret(String(clientSecret).trim(), APP_SETTINGS_KEY) : prev.secret || '',
    enabled: enabled ?? prev.enabled ?? false,
  }
  if (next.enabled && !(next.clientId && next.secret)) {
    throw new IdentityError(`Enter the ${providerLabel(kind)} client ID and secret before turning it on.`)
  }
  await setSetting(KEY, { ...stored, [kind]: next })
  return adminProviders()
}

export async function clearProvider(kind) {
  assertKind(kind)
  const { [kind]: _removed, ...rest } = await getSetting(KEY)
  await setSetting(KEY, rest)
  return adminProviders()
}
