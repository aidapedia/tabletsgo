/**
 * Enrolling with Hayat — how an enterprise instance gets its credentials
 * without anyone copying a secret.
 *
 * An admin makes a one-time enrollment code in Hayat's console (Services →
 * Enroll service, namespace `tabletsgo`) and pastes it into tabletsgo's setup
 * page. Tabletsgo redeems it on Hayat's api role, sending its contract, its
 * address and who should be its admin; Hayat registers tabletsgo (or, for a
 * tabletsgo it knows, rotates its secret) and answers with the API credential
 * and the browser's sign-in client. They are kept here, the secret sealed under
 * ENCRYPTION_KEY, in `app_settings` key `hayat`.
 *
 * Hayat's addresses (HAYAT_ISSUER, HAYAT_API_URL) are in the environment; the
 * credentials never are. Enrolling is the one way in: the setup page, Admin →
 * Hayat, or `npm run hayat:enroll` for a headless install.
 *
 * Sits beside app-settings.js: it reads and writes the store, and hands what
 * it reads to server/hayat, which never touches the store itself.
 */

import { HAYAT_ISSUER, PUBLIC_URL } from './config.js'
import { APP_SETTINGS_KEY, decryptSecret, encryptSecret } from './crypto.js'
import { clearSetting, getSetting, setSetting } from './app-settings.js'
import { SERVICE, contractManifest, roleSlug } from './permissions-catalog.js'
import * as hayat from './hayat/index.js'

const KEY = 'hayat'
const CODE = /^hye_[A-Za-z0-9_-]{20,}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class EnrollmentError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

/** The stored credentials, the secret in the clear, or null. Server-side only. */
export async function storedCredentials() {
  const s = await getSetting(KEY)
  if (!s.clientId || !s.clientSecret) return null
  try {
    return { clientId: s.clientId, clientSecret: decryptSecret(s.clientSecret, APP_SETTINGS_KEY), webClientId: s.webClientId || '' }
  } catch {
    // Sealed under another ENCRYPTION_KEY: unusable. The setup page opens, and a
    // new code from Hayat's console fixes it.
    console.warn("⚠️  Hayat credentials in the store can't be decrypted with this ENCRYPTION_KEY — enroll again with a new code.")
    return null
  }
}

/**
 * At boot: hand server/hayat the stored credentials, and let it reload them
 * when Hayat refuses the ones it holds — another replica may have re-enrolled.
 */
export async function connectStored() {
  hayat.onCredentialsRefused(storedCredentials)
  const creds = await storedCredentials()
  if (!creds) return null
  hayat.useCredentials(creds)
  return 'enrolled'
}

const checkCode = (code) => {
  const c = String(code || '').trim()
  if (!CODE.test(c)) throw new EnrollmentError("That isn't an enrollment code — it starts with hye_. Copy it whole from Hayat's console.")
  return c
}

// The address people open this instance at, where Hayat sends them back after
// signing in. PUBLIC_URL when set; otherwise the address the setup page was
// opened at, which is the one that just worked in a browser.
function appAddress(fromBrowser) {
  if (PUBLIC_URL) return PUBLIC_URL
  let u
  try {
    u = new URL(String(fromBrowser || ''))
  } catch {
    throw new EnrollmentError("Couldn't tell this instance's address. Set PUBLIC_URL.")
  }
  if (!/^https?:$/.test(u.protocol)) throw new EnrollmentError('The address must start with https://')
  return `${u.protocol}//${u.host}`
}

const hayatMessage = (e) => {
  if (e instanceof hayat.HayatError) return new EnrollmentError(e.message, e.code === 'unavailable' ? 502 : 400)
  return e
}

/**
 * What a code would do, for the setup page to show before it is spent: which
 * service, whether it registers tabletsgo or rotates its secret, who made it
 * (by default, the admin of a tabletsgo it registers).
 */
export async function inspect(code) {
  let res
  try {
    res = await hayat.inspectEnrollment(checkCode(code))
  } catch (e) {
    throw hayatMessage(e)
  }
  if (res.serviceId !== SERVICE) {
    throw new EnrollmentError(`This code is for "${res.serviceId}", not tabletsgo. Make one for the namespace "${SERVICE}".`)
  }
  return {
    serviceId: res.serviceId,
    displayName: res.displayName || SERVICE,
    registers: !!res.registers,
    madeBy: { email: res.madeByEmail || '', name: res.madeByName || '' },
    expiresAt: res.expiresAt || null,
    issuer: res.issuer || null,
    issuerMatches: !res.issuer || res.issuer === HAYAT_ISSUER,
    address: PUBLIC_URL || null,
  }
}

/**
 * Spend a code. `adminEmail` names tabletsgo's admin when the code registers
 * it (empty: whoever made the code). `address` is the browser's origin, used
 * when PUBLIC_URL isn't set. Stores the credentials and starts using them.
 */
export async function enroll({ code, adminEmail = '', address }, { actor = null, log = console.log } = {}) {
  const admin = String(adminEmail || '').trim()
  if (admin && !EMAIL.test(admin)) throw new EnrollmentError('Enter the admin as an email address.')
  const request = {
    code: checkCode(code),
    manifest: contractManifest(),
    displayName: 'Tabletsgo',
    description: 'Database console: connections, queries, schemas, workflows and dashboards.',
    appUrl: appAddress(address),
    adminRole: roleSlug('admin'),
    adminEmail: admin,
  }
  let res
  try {
    res = await hayat.redeemEnrollment(request)
  } catch (e) {
    throw hayatMessage(e)
  }
  const warnings = [...(res.warnings || [])]
  if (res.issuer && res.issuer !== HAYAT_ISSUER) {
    warnings.push(`Hayat calls itself ${res.issuer}, but HAYAT_ISSUER is ${HAYAT_ISSUER}. Sign-in tokens won't verify until they match.`)
  }
  await setSetting(KEY, {
    serviceId: res.serviceId,
    clientId: res.clientId,
    clientSecret: encryptSecret(res.clientSecret, APP_SETTINGS_KEY),
    webClientId: res.webClientId || '',
    issuer: res.issuer || HAYAT_ISSUER,
    address: request.appUrl,
    enrolledAt: Date.now(),
    enrolledBy: actor,
    registered: !!res.registered,
  })
  hayat.useCredentials({ clientId: res.clientId, clientSecret: res.clientSecret, webClientId: res.webClientId })
  // The contract went with the code; this follows Hayat's policy changes again.
  await hayat.startHayat({ contract: request.manifest, log })
  log(`🔑 Enrolled with Hayat at ${res.issuer || HAYAT_ISSUER} (${res.registered ? 'registered' : 'secret rotated'}).`)
  return { registered: !!res.registered, contractVersion: res.contractVersion || 0, warnings, address: request.appUrl }
}

/** For Admin → Hayat: where the credentials come from and when they were made. Never the secret. */
export async function status() {
  const state = hayat.enrollmentState()
  if (!state) return null
  const s = await getSetting(KEY)
  return {
    ...state,
    namespace: SERVICE,
    publicUrl: PUBLIC_URL || null,
    address: s.address || null,
    enrolledAt: s.enrolledAt || null,
    registered: s.registered ?? null,
  }
}

/** Forget stored credentials (tests). */
export const forget = () => clearSetting(KEY)
