/**
 * Cloudflare Access as a transport — how an SSH host behind a Cloudflare Tunnel
 * is reached.
 *
 * Such a host has no open TCP port. `cloudflared access ssh` (the usual SSH
 * ProxyCommand) opens a WebSocket to the Access application's hostname and
 * carries the raw SSH byte stream in binary frames; Access lets the upgrade
 * through only with valid credentials — for a machine, a *service token* sent
 * as the `Cf-Access-Client-Id` / `Cf-Access-Client-Secret` headers. This does
 * the same natively, so the image needs no `cloudflared` binary, and hands back
 * a plain duplex stream that ssh2 runs the SSH session over.
 *
 * Failures carry `accessReason` (see `explainAccessError`) so they explain
 * Cloudflare, not SSH or the database.
 */

import WebSocket, { createWebSocketStream } from 'ws'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * The WebSocket URL for an Access hostname. A bare hostname (the normal case)
 * or an https:// URL becomes wss://. Plain ws:// is accepted only for loopback,
 * which is a local test rig — anywhere else it would send the service token in
 * the clear.
 */
export function accessUrl(hostname) {
  const raw = String(hostname || '').trim()
  if (!raw) throw Object.assign(new Error('An Access hostname is required.'), { status: 400 })
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `wss://${raw}`
  let url
  try {
    url = new URL(withScheme.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:'))
  } catch {
    throw Object.assign(new Error(`"${raw}" is not a valid hostname.`), { status: 400 })
  }
  if (url.protocol === 'ws:' && !LOOPBACK.has(url.hostname)) {
    throw Object.assign(new Error('Cloudflare Access must be reached over wss:// (TLS).'), { status: 400 })
  }
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') {
    throw Object.assign(new Error(`Unsupported scheme "${url.protocol}" for an Access hostname.`), { status: 400 })
  }
  return url.toString()
}

/**
 * Open the stream. Resolves a Duplex once Access has accepted the upgrade;
 * rejects with an error carrying `accessReason`.
 */
export function openAccessStream({ hostname, clientId, clientSecret, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    let url
    try {
      url = accessUrl(hostname)
    } catch (error) {
      return reject(error)
    }
    const headers = {}
    if (clientId) headers['Cf-Access-Client-Id'] = clientId
    if (clientSecret) headers['Cf-Access-Client-Secret'] = clientSecret
    const ws = new WebSocket(url, { headers, handshakeTimeout: timeoutMs, followRedirects: false })
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      ws.terminate()
      reject(error)
    }
    ws.once('unexpected-response', (req, res) => {
      res.resume()
      fail(Object.assign(new Error(`Cloudflare Access answered HTTP ${res.statusCode}`), { accessReason: true, status: res.statusCode, location: res.headers.location }))
    })
    ws.once('error', (error) => fail(Object.assign(error, { accessReason: true })))
    ws.once('open', () => {
      settled = true
      const stream = createWebSocketStream(ws)
      // A dropped socket ends the SSH session through 'close'; an 'error'
      // without a listener would crash the process instead.
      stream.on('error', () => stream.destroy())
      resolve(stream)
    })
  })
}

/** `{ cause, hint }` for a failed `openAccessStream`, worded for the connect dialog. */
export function explainAccessError(error, hostname) {
  const code = error?.code || ''
  const status = error?.status
  if (status === 302 || status === 301 || status === 401 || status === 403) {
    return {
      cause: `Cloudflare Access refused ${hostname} (HTTP ${status}).`,
      hint:
        status === 302 || status === 301
          ? 'Access wants a login, which means it did not accept a service token — add one to this SSH host, and give the Access application a "Service Auth" policy that includes it.'
          : 'Check the service token ID and secret, that the token has not expired, and that the Access application has a "Service Auth" policy including it.',
    }
  }
  if (status === 502 || status === 503 || status === 530) {
    return {
      cause: `Cloudflare reached ${hostname} but nothing answered behind it (HTTP ${status}).`,
      hint: 'Check that cloudflared is running on the tunnel and that its ingress maps this hostname to the SSH server (e.g. service: ssh://localhost:22).',
    }
  }
  if (status) {
    return { cause: `Cloudflare Access answered HTTP ${status} for ${hostname}.`, hint: 'Check that the hostname is a Cloudflare Access application in front of an SSH service.' }
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { cause: `The Access hostname "${hostname}" could not be resolved.`, hint: 'Check the hostname for typos, and that its DNS record points at the tunnel.' }
  }
  if (code === 'ETIMEDOUT' || /timed? ?out/i.test(error?.message || '')) {
    return { cause: `Cloudflare did not answer for ${hostname} in time.`, hint: 'Check that this server can make outbound HTTPS connections.' }
  }
  return { cause: `Could not open Cloudflare Access to ${hostname}: ${error?.message || 'connection failed'}.`, hint: 'Check the Access hostname and service token.' }
}
