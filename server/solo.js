/**
 * Solo mode's one person: setup, sign-in, session tokens, their account and the
 * one workspace's name.
 *
 * Owns `app_settings` key `solo` — never a table of people (CLAUDE.md
 * "INVARIANTS"). Solo keeps exactly one owner; a second person means enterprise
 * mode, where Hayat owns identity. The value:
 *
 *   { owner: { id, email, name, timezone, passwordHash } | null,
 *     workspace: { id, name },
 *     tokenEpoch }
 *
 * `owner` is null until the first-run setup. The migrator creates the row on a
 * solo instance's first boot (server/migrator/identity.js), and it is what the
 * Hayat import bundle is built from when the instance moves to enterprise.
 *
 * Sessions are two HS256 JWTs signed under SOLO_SESSION_KEY: a 15-minute access
 * token the console sends as `Authorization: Bearer` (verified by
 * server/hayat/solo-backend.js through `verifyAccess`) and a 30-day refresh
 * token in an httpOnly cookie. Both carry `tokenEpoch`; bumping it (a password
 * change, "sign out everywhere") ends every session at once, with nothing
 * stored per session.
 *
 * In enterprise mode every function here answers 404, so the routes that call
 * them don't branch on the mode.
 */

import { randomInt, randomUUID, timingSafeEqual } from 'crypto'
import { SignJWT, jwtVerify } from 'jose'
import { getSetting, setSetting } from './app-settings.js'
import { SOLO_SESSION_KEY, hashPassword, verifyPassword } from './crypto.js'
import { isSolo } from './mode.js'
import * as hayat from './hayat/index.js'

export const SETTING_KEY = 'solo'
const ISSUER = 'tabletsgo-solo'
const CLIENT_ID = 'tabletsgo-solo'
export const ACCESS_TTL_S = 15 * 60
export const REFRESH_TTL_S = 30 * 24 * 60 * 60
export const REFRESH_COOKIE = 'tabletsgo_solo_refresh'
const COOKIE_PATH = '/api/auth/solo'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8

const fail = (status, message) => Object.assign(new Error(message), { status })
const assertSolo = () => {
  if (!isSolo()) throw fail(404, 'Not found')
}

// ---- State -------------------------------------------------------------------------

let state = null

/** Read the `solo` setting into memory. Sign-in reads it fresh, so a reset from the shell counts. */
export async function loadSolo() {
  const value = await getSetting(SETTING_KEY)
  state = { owner: value.owner || null, workspace: value.workspace || { id: '', name: 'Personal' }, tokenEpoch: value.tokenEpoch || 0 }
  return state
}

/** The in-memory copy — what server/hayat/solo-backend.js answers from. */
export const current = () => state

async function save(next) {
  state = next
  await setSetting(SETTING_KEY, next)
  // The owner's profile and the workspace's name sit in server/hayat's caches.
  hayat.dropCaches()
}

export const setupRequired = () => !state?.owner

/** The signed-in shape routes hand the console (as server/auth.js publicUser). */
const publicOwner = (o) => ({ id: o.id, email: o.email, name: o.name || '', role: 'admin', timezone: o.timezone || null, picture: null })

// ---- First run ---------------------------------------------------------------------

// Six words from 64: ~36 bits, and five tries a minute.
const WORDS = (
  'amber anchor apple arrow aspen basil birch bison brook cedar cliff cloud comet coral crane delta dune ember fern ' +
  'fjord flint frost gecko glade harbor hazel heron iris ivory jade kelp lark lemon lotus maple marsh meadow mint ' +
  'moss north oak olive onyx orbit otter pearl pine plum quartz raven reef river robin sage shore slate spruce ' +
  'stone swift tide tulip willow'
).split(' ')

let setupCode = null

/**
 * A new solo instance prints a one-time code to its log; the setup page asks for
 * it. Whoever can reach the port but not read the log can't claim the instance.
 */
export function announceSetup(log = console.log, publicUrl = '') {
  if (!isSolo() || !setupRequired()) return null
  setupCode = Array.from({ length: 6 }, () => WORDS[randomInt(WORDS.length)]).join('-')
  log(`🔑 Solo setup: open ${publicUrl || 'tabletsgo'} and enter this code: ${setupCode}`)
  return setupCode
}

const sameText = (a, b) => {
  const x = Buffer.from(String(a || '').trim().toLowerCase())
  const y = Buffer.from(String(b || ''))
  return x.length === y.length && timingSafeEqual(x, y)
}

function validProfile({ name, email, timezone }) {
  const address = String(email || '').trim().toLowerCase()
  if (!EMAIL.test(address)) throw fail(400, 'Enter a valid email address.')
  return { email: address, name: String(name || '').trim().slice(0, 120), timezone: timezone ? String(timezone).slice(0, 64) : null }
}

function validPassword(password) {
  if (String(password || '').length < MIN_PASSWORD) throw fail(400, `Use at least ${MIN_PASSWORD} characters for the password.`)
  return String(password)
}

/** Claim a new instance. → the owner. */
export async function setup({ code, name, email, password, timezone } = {}, ip = '') {
  assertSolo()
  if (!setupRequired()) throw fail(409, 'This instance is already set up. Sign in instead.')
  limit(ip)
  if (!setupCode || !sameText(code, setupCode)) {
    failed(ip)
    throw fail(403, 'That setup code is wrong. Copy it from the container log.')
  }
  const profile = validProfile({ name, email, timezone })
  const owner = { id: randomUUID(), ...profile, passwordHash: await hashPassword(validPassword(password)) }
  await save({ ...state, owner })
  setupCode = null
  return owner
}

// ---- Signing in --------------------------------------------------------------------

// Failed attempts per address in the last minute. In process: one person, one replica.
const WINDOW_MS = 60_000
const MAX_FAILURES = 5
const failures = new Map()

function limit(ip) {
  const recent = (failures.get(ip) || []).filter((t) => Date.now() - t < WINDOW_MS)
  failures.set(ip, recent)
  if (recent.length >= MAX_FAILURES) throw fail(429, 'Too many attempts. Wait a minute and try again.')
}
const failed = (ip) => failures.set(ip, [...(failures.get(ip) || []), Date.now()])

/** Email + password → the owner, or a 401. */
export async function signIn({ email, password } = {}, ip = '') {
  assertSolo()
  await loadSolo()
  if (setupRequired()) throw fail(409, 'This instance isn’t set up yet.')
  limit(ip)
  const o = state.owner
  const { ok, legacy } = await verifyPassword(String(password || ''), o.passwordHash)
  if (!ok || String(email || '').trim().toLowerCase() !== o.email) {
    failed(ip)
    throw fail(401, 'Wrong email or password.')
  }
  failures.delete(ip)
  // A v1.0 account's unsalted hash is replaced the first time it is used.
  if (legacy) await save({ ...state, owner: { ...o, passwordHash: await hashPassword(password) } })
  return state.owner
}

// ---- Tokens ------------------------------------------------------------------------

const sign = (owner, typ, ttl) =>
  new SignJWT({ client_id: CLIENT_ID, typ, epoch: state.tokenEpoch || 0 })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setSubject(owner.id)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(SOLO_SESSION_KEY)

/** → { accessToken, expiresIn, refreshToken, user }. */
export async function issueTokens(owner = state?.owner) {
  return {
    accessToken: await sign(owner, 'access', ACCESS_TTL_S),
    expiresIn: ACCESS_TTL_S,
    refreshToken: await sign(owner, 'refresh', REFRESH_TTL_S),
    user: publicOwner(owner),
  }
}

// Error messages say "signature"/"expired" so server/auth.js treats them as a
// plain signed-out request rather than logging them.
async function verifyTyped(token, typ) {
  const { payload } = await jwtVerify(String(token || ''), SOLO_SESSION_KEY, { issuer: ISSUER, algorithms: ['HS256'] })
  if (payload.typ !== typ) throw new Error(`signature: not a solo ${typ} token`)
  if (!state?.owner || payload.sub !== state.owner.id) throw new Error('signature: not this instance’s owner')
  if ((payload.epoch ?? -1) !== (state.tokenEpoch || 0)) throw new Error('expired: signed out everywhere')
  return payload
}

/** The verifier server/hayat/solo-backend.js uses for `Authorization: Bearer`. */
export const verifyAccess = (token) => verifyTyped(token, 'access')

/** The refresh cookie → fresh tokens. */
export async function refresh(token) {
  assertSolo()
  await loadSolo()
  try {
    await verifyTyped(token, 'refresh')
  } catch {
    throw fail(401, 'Sign in again.')
  }
  return issueTokens()
}

/** Sign out. `everywhere` ends every session on every device. */
export async function signOut({ everywhere = false } = {}) {
  assertSolo()
  if (everywhere) await save({ ...state, tokenEpoch: (state.tokenEpoch || 0) + 1 })
}

// ---- The refresh cookie --------------------------------------------------------------

export function refreshCookie(token, { secure }) {
  const parts = [`${REFRESH_COOKIE}=${token}`, `Path=${COOKIE_PATH}`, 'HttpOnly', 'SameSite=Strict', `Max-Age=${token ? REFRESH_TTL_S : 0}`]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function readRefreshCookie(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === REFRESH_COOKIE) return v.join('=')
  }
  return ''
}

// ---- The account -------------------------------------------------------------------------

export async function updateAccount(patch = {}) {
  assertSolo()
  const o = state.owner
  const next = validProfile({ name: patch.name ?? o.name, email: patch.email ?? o.email, timezone: patch.timezone === undefined ? o.timezone : patch.timezone })
  await save({ ...state, owner: { ...o, ...next } })
  return publicOwner(state.owner)
}

/** Change the password; every other session ends. → fresh tokens for this one. */
export async function changePassword({ current: currentPassword, next } = {}, ip = '') {
  assertSolo()
  limit(ip)
  const { ok } = await verifyPassword(String(currentPassword || ''), state.owner.passwordHash)
  if (!ok) {
    failed(ip)
    throw fail(403, 'The current password is wrong.')
  }
  const passwordHash = await hashPassword(validPassword(next))
  await save({ ...state, owner: { ...state.owner, passwordHash }, tokenEpoch: (state.tokenEpoch || 0) + 1 })
  return issueTokens()
}

/** The one workspace's name (server/hayat/solo-backend.js → UpdateTenant). */
export async function renameWorkspace(name) {
  assertSolo()
  const value = String(name || '').trim().slice(0, 120)
  if (!value) throw fail(400, 'Give the workspace a name.')
  await save({ ...state, workspace: { ...state.workspace, name: value } })
}
