/**
 * The HTTP services that sit beside a Kafka cluster — Schema Registry, Kafka
 * Connect, ksqlDB — called the one way: the connection's URL + Basic auth for
 * that service, its TLS settings, and the same SSH tunnel the brokers use.
 *
 * Record fields, one set per service (`<service>Url`, `<service>Username`,
 * `<service>Password`): schemaRegistry*, connect*, ksql*. TLS reuses the
 * connection's: `caCert` is trusted alongside the public roots, `tls ===
 * 'insecure'` skips verification, and a client certificate is presented when
 * one is set (Confluent's services take mTLS too).
 *
 * Every request goes through `http.request` with its own `createConnection`, so
 * a tunneled connection reaches the service through `conn.forwardPort` exactly
 * as the Kafka socket factory does, and TLS still verifies the real host name.
 */

import http from 'http'
import net from 'net'
import tls from 'tls'
import { clientCertOf } from './kafka-auth.js'

export const SERVICES = {
  schemaRegistry: 'Schema Registry',
  connect: 'Kafka Connect',
  ksql: 'ksqlDB',
}

const SETTING_HINT = 'add its URL in the connection settings'

/** The service's base URL, or null when the connection doesn't name one. */
export function serviceUrl(conn, service) {
  const raw = String(conn?.[`${service}Url`] || '').trim()
  return raw ? raw.replace(/\/+$/, '') : null
}

function requireUrl(conn, service) {
  const raw = serviceUrl(conn, service)
  if (!raw) throw Object.assign(new Error(`This connection has no ${SERVICES[service]} — ${SETTING_HINT}.`), { status: 400, reason: 'not_configured' })
  try {
    return new URL(raw)
  } catch {
    throw Object.assign(new Error(`"${raw}" is not a valid ${SERVICES[service]} URL.`), { status: 400 })
  }
}

// The socket under one request: direct, or through the connection's SSH tunnel.
function connector(conn, url) {
  const secure = url.protocol === 'https:'
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const port = Number(url.port) || (secure ? 443 : 80)
  const tlsOptions = secure
    ? {
        servername: net.isIP(host) ? undefined : host,
        rejectUnauthorized: conn.tls !== 'insecure',
        ...(conn.caCert?.trim() ? { ca: [...tls.rootCertificates, conn.caCert] } : {}),
        ...(conn.clientCertFormat ? clientCertOf(conn) : {}),
      }
    : null
  return () => {
    if (typeof conn.forwardPort !== 'function') {
      return secure ? tls.connect({ host, port, ...tlsOptions }) : net.connect(port, host)
    }
    const raw = new net.Socket()
    const socket = secure ? tls.connect({ ...tlsOptions, socket: raw }) : raw
    if (socket !== raw) raw.on('error', (error) => socket.destroy(error))
    conn
      .forwardPort(host, port)
      .then((local) => raw.connect(local, '127.0.0.1'))
      .catch((error) => raw.destroy(error))
    return socket
  }
}

const STATUS = { 400: 400, 401: 403, 403: 403, 404: 404, 405: 400, 409: 409, 412: 409, 415: 400, 422: 400 }

/**
 * One call to a service. `path` is appended to the configured URL (so a URL
 * with a path prefix works). Resolves to the parsed JSON body (or the text, or
 * null for an empty one); rejects with `status` set — the service's own error
 * message when it sent one.
 *
 * `bounded` reads a body that may never end (a ksqlDB push query): the request
 * is cut off once `bounded.enough(text so far)` says so, or after
 * `bounded.maxMs`, and resolves `{ text, cut }` with whatever arrived.
 */
export function restRequest(conn, service, { method = 'GET', path = '/', body, headers = {}, timeoutMs = 15000, bounded = null } = {}) {
  const url = requireUrl(conn, service)
  const base = url.pathname.replace(/\/+$/, '')
  const payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  const user = conn[`${service}Username`]
  const auth = user ? `Basic ${Buffer.from(`${user}:${conn[`${service}Password`] || ''}`).toString('base64')}` : null
  const name = SERVICES[service]

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        host: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${base}${path}`,
        createConnection: connector(conn, url),
        headers: {
          accept: 'application/json',
          ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
          ...(auth ? { authorization: auth } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = []
        if (bounded && res.statusCode >= 200 && res.statusCode < 300) {
          let done = false
          const finish = (cut) => {
            if (done) return
            done = true
            clearTimeout(timer)
            resolve({ text: Buffer.concat(chunks).toString('utf8'), cut })
            if (cut) req.destroy()
          }
          const timer = setTimeout(() => finish(true), bounded.maxMs)
          res.on('data', (c) => {
            chunks.push(c)
            if (bounded.enough(Buffer.concat(chunks).toString('utf8'))) finish(true)
          })
          res.on('end', () => finish(false))
          res.on('error', () => finish(true))
          return
        }
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try {
            json = text ? JSON.parse(text) : null
          } catch {
            json = text
          }
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json)
          const detail = (json && typeof json === 'object' && (json.message || json.error)) || (typeof json === 'string' && json.trim()) || `HTTP ${res.statusCode}`
          const message =
            res.statusCode === 401 || res.statusCode === 403 ? `${name} refused the credentials (${detail}).` : String(detail)
          reject(Object.assign(new Error(message), { status: STATUS[res.statusCode] || 502, code: json?.error_code, httpStatus: res.statusCode, body: json }))
        })
        res.on('error', reject)
      }
    )
    // A bounded read cuts itself off; this only catches a service that never answers at all.
    const limit = bounded ? Math.max(timeoutMs, bounded.maxMs + 5000) : timeoutMs
    req.setTimeout(limit, () => req.destroy(Object.assign(new Error(`${name} did not answer within ${Math.round(limit / 1000)} s.`), { status: 504 })))
    req.on('error', (error) => {
      if (error.status) return reject(error)
      const why = error.code || error.message
      reject(Object.assign(new Error(`${name} at ${url.origin} could not be reached (${why}).`), { status: 502, cause: error }))
    })
    if (payload) req.write(payload)
    req.end()
  })
}
