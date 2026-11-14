/**
 * The wire to Hayat's service API: the Connect protocol over fetch, plus the
 * client-credentials token every call carries.
 *
 * Connect is plain HTTP — a unary call is a JSON POST to
 * `/<package>.<Service>/<Method>`, a server stream is length-prefixed JSON
 * frames — so tabletsgo talks to Hayat without generated code or a gRPC stack.
 * Field names are proto3 JSON (camelCase); int64 values arrive as strings.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose'

const PKG = 'hayat.authz.v1'

export class HayatError extends Error {
  constructor(code, message, status) {
    super(message || code)
    this.name = 'HayatError'
    this.code = code // Connect code: not_found, failed_precondition, permission_denied, …
    this.status = status
  }
}

/** A live connection to one Hayat. Created once by server/hayat/index.js. */
export function connectHayat({ issuer, authUrl = issuer, apiUrl, clientId, clientSecret }) {
  let discovery = null
  let jwks = null
  let token = ''
  let tokenExpires = 0
  let tokenPending = null

  async function discover() {
    if (discovery) return discovery
    const res = await fetch(`${authUrl}/.well-known/openid-configuration`)
    if (!res.ok) throw new Error(`Hayat discovery at ${authUrl} answered ${res.status}`)
    const d = await res.json()
    // Discovery names its endpoints under the public issuer; reach them the way
    // this server reaches the auth role. The issuer itself stays as published.
    const reach = (url) => (url && url.startsWith(d.issuer) ? authUrl + url.slice(d.issuer.length) : url)
    discovery = { ...d, token_endpoint: reach(d.token_endpoint), jwks_uri: reach(d.jwks_uri) }
    jwks = createRemoteJWKSet(new URL(discovery.jwks_uri))
    return discovery
  }

  // A client-credentials token, renewed 30 s before it lapses. One request at a
  // time: concurrent callers share the pending one.
  async function accessToken() {
    if (token && Date.now() < tokenExpires - 30_000) return token
    tokenPending ??= (async () => {
      try {
        const { token_endpoint } = await discover()
        const res = await fetch(token_endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: 'Basic ' + Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64'),
          },
          body: new URLSearchParams({ grant_type: 'client_credentials' }),
        })
        if (!res.ok) throw new Error(`Hayat refused tabletsgo's service credentials (${res.status})`)
        const body = await res.json()
        token = body.access_token
        tokenExpires = Date.now() + body.expires_in * 1000
        return token
      } finally {
        tokenPending = null
      }
    })()
    return tokenPending
  }

  /** One unary RPC: call('AuthzService', 'Check', { userId, … }). */
  async function call(service, method, body = {}) {
    const res = await fetch(`${apiUrl}/${PKG}.${service}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', Authorization: `Bearer ${await accessToken()}` },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    const json = text ? JSON.parse(text) : {}
    if (!res.ok) throw new HayatError(json.code || 'unknown', json.message || `Hayat answered ${res.status}`, res.status)
    return json
  }

  /**
   * Stream WatchService.Watch, calling onEvent for each policy event, until the
   * signal aborts or the stream ends (the caller reconnects).
   */
  async function watch(cursor, onEvent, signal) {
    const msg = Buffer.from(JSON.stringify({ cursor }))
    const frame = Buffer.alloc(5 + msg.length)
    frame.writeUInt32BE(msg.length, 1)
    msg.copy(frame, 5)
    const res = await fetch(`${apiUrl}/${PKG}.WatchService/Watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/connect+json', 'Connect-Protocol-Version': '1', Authorization: `Bearer ${await accessToken()}` },
      body: frame,
      signal,
    })
    if (!res.ok || !res.body) throw new HayatError('unavailable', `Hayat Watch answered ${res.status}`, res.status)
    let buf = Buffer.alloc(0)
    for await (const chunk of res.body) {
      buf = Buffer.concat([buf, Buffer.from(chunk)])
      while (buf.length >= 5) {
        const flags = buf[0]
        const len = buf.readUInt32BE(1)
        if (buf.length < 5 + len) break
        const payload = JSON.parse(buf.subarray(5, 5 + len).toString('utf8') || '{}')
        buf = buf.subarray(5 + len)
        if (flags & 0x02) {
          if (payload.error) throw new HayatError(payload.error.code, payload.error.message)
          return
        }
        if (payload.event) onEvent(payload.event)
      }
    }
  }

  /** A person's access token, verified offline. Returns its claims. */
  async function verify(raw) {
    const d = await discover()
    const { payload } = await jwtVerify(raw, jwks, { issuer: d.issuer })
    if (String(payload.sub || '').startsWith('client:')) throw new Error('a service token, not a person')
    return payload
  }

  return { call, watch, verify, discover }
}
