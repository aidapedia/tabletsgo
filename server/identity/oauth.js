/**
 * The round trip to Google or GitHub — no knowledge of accounts.
 *
 * `startFlow` records what the round trip is for (sign in, link an account,
 * accept an invite) and returns the provider's URL; the callback calls
 * `finishFlow` to get that record back with the person's profile.
 *
 * Plain authorization-code flow over HTTPS, straight to each provider's token
 * endpoint. Because that channel is authenticated, the profile needs no further
 * signature checks, which is why no OAuth library is involved.
 */

import { createHash, randomBytes, randomUUID } from 'crypto'
import { putOneTime, takeOneTime } from '../sessions/index.js'
import { IdentityError } from './identities.js'
import { providerApp, providerLabel } from './providers.js'

const FLOW_TTL_MS = 10 * 60 * 1000
const REQUEST_TIMEOUT_MS = 10 * 1000
const COOKIE = 'tg_oauth'

const form = (fields) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
  body: new URLSearchParams(fields),
  signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
})

const fetchJson = async (url, init) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...init })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}: ${body.error_description || body.error || body.message || ''}`)
  return body
}

const bearer = (token) => ({ headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'tabletsgo' } })

// Each provider: where to send the browser, and how to turn a code into
// { subject, email, emailVerified, name }.
const KINDS = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    params: { scope: 'openid email profile', prompt: 'select_account' },
    async profile(grant) {
      const { access_token } = await fetchJson('https://oauth2.googleapis.com/token', form({ ...grant, grant_type: 'authorization_code' }))
      const me = await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', bearer(access_token))
      return { subject: String(me.sub), email: me.email, emailVerified: me.email_verified === true, name: me.name }
    },
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    params: { scope: 'read:user user:email' },
    async profile(grant) {
      // GitHub answers a bad code with 200 and an `error` field.
      const { access_token, error_description } = await fetchJson('https://github.com/login/oauth/access_token', form(grant))
      if (!access_token) throw new Error(`github.com refused the code: ${error_description || 'no token'}`)
      const me = await fetchJson('https://api.github.com/user', bearer(access_token))
      const emails = await fetchJson('https://api.github.com/user/emails', bearer(access_token))
      const primary = emails.find((e) => e.primary)
      return { subject: String(me.id), email: primary?.email, emailVerified: primary?.verified === true, name: me.name || me.login }
    },
  },
}

const challengeOf = (verifier) => createHash('sha256').update(verifier).digest('base64url')

/**
 * Begin a round trip. `purpose` is { intent: 'login' | 'link' | 'invite', userId?, inviteToken? }.
 * Returns the URL to send the browser to, and the value for the flow cookie that
 * ties the callback to this browser — a state alone would let someone hand a
 * victim a callback link and sign them in as the attacker.
 */
export async function startFlow(kind, purpose, callbackUrl) {
  const app = await providerApp(kind)
  if (!app) throw new IdentityError(`${providerLabel(kind)} sign-in is turned off.`, 'provider_off', 403)
  const state = randomUUID()
  const binding = randomBytes(24).toString('base64url')
  const verifier = randomBytes(32).toString('base64url')
  await putOneTime(state, { ...purpose, kind, binding, verifier, callbackUrl }, FLOW_TTL_MS)
  const url = new URL(KINDS[kind].authorizeUrl)
  url.search = new URLSearchParams({
    ...KINDS[kind].params,
    client_id: app.clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    state,
    code_challenge: challengeOf(verifier),
    code_challenge_method: 'S256',
  })
  return { url: url.toString(), binding }
}

/** The purpose a callback belongs to, or null if it's unknown, used, or from another browser. */
export async function takeFlow(state, binding) {
  const flow = await takeOneTime(state)
  return flow && binding && flow.binding === binding ? flow : null
}

/** Exchange the code for the person's profile. */
export async function fetchProfile(flow, code) {
  const app = await providerApp(flow.kind)
  if (!app) throw new IdentityError(`${providerLabel(flow.kind)} sign-in is turned off.`, 'provider_off', 403)
  const profile = await KINDS[flow.kind].profile({
    client_id: app.clientId,
    client_secret: app.clientSecret,
    code,
    code_verifier: flow.verifier,
    redirect_uri: flow.callbackUrl,
  })
  return { ...profile, email: profile.email?.trim().toLowerCase() || null }
}

export const flowCookie = (value, { secure }) =>
  `${COOKIE}=${value}; Path=/api/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=${value ? FLOW_TTL_MS / 1000 : 0}${secure ? '; Secure' : ''}`

export const readFlowCookie = (req) =>
  (req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([name]) => name === COOKIE)?.[1] || null
