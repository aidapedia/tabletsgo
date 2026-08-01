/**
 * Why a connection attempt failed, in words a user can act on.
 *
 * The console runs a handshake before it opens a connection (see `handshake` in
 * ./index.js), so a failure has to explain itself rather than just answer
 * `{ ok: false }`. The split follows the rule the rest of the db layer follows:
 * transport failures are engine-agnostic (a refused TCP connection is refused
 * identically for every engine) and are classified here, while the parts only
 * an engine can explain — a Postgres SQLSTATE, a Redis error reply, a SQLite
 * file error — come from that driver's optional `explainError(error, conn)`.
 * A driver never builds the whole answer; it adds only what this can't know.
 */

import { describeError } from '../util.js'

// The reason codes a client may branch on. `cause`/`hint` are prose meant to be
// rendered as-is, so adding a reason here never breaks an older frontend.
// `at_capacity` isn't produced here — it comes from the session limit in
// ./index.js — but it's listed so the full set a client may see lives in one place.
export const REASONS = [
  'dns', 'refused', 'timeout', 'network', 'tls', 'auth', 'permission',
  'missing_database', 'missing_file', 'busy', 'at_capacity', 'unsupported', 'unknown',
]

// What this connection points at, as one string: "host:port", a file path, or a
// URI's host. Never the credentials — a URI's userinfo is dropped on purpose.
export function targetOf(conn = {}) {
  if (conn.type === 'sqlite') return conn.filepath || ''
  if (conn.uri) {
    try {
      return new URL(conn.uri).host || conn.uri
    } catch {
      return conn.uri
    }
  }
  return conn.host ? `${conn.host}${conn.port ? `:${conn.port}` : ''}` : ''
}

// Node/libuv error codes travel differently per client library: pg puts them on
// the error, ioredis sometimes nests them, and the AWS-style AggregateError
// hides them in `.errors[0]`.
const codeOf = (error) =>
  error?.code || error?.errors?.[0]?.code || error?.cause?.code || ''

// Transport-level failures, identical for every engine. Returns null when the
// error isn't one of them (i.e. we got far enough to talk to the database).
export function classifyTransport(error, conn = {}) {
  const code = String(codeOf(error) || '')
  const message = describeError(error) || ''
  const target = targetOf(conn) || 'the server'
  const dockerNote =
    ' If TabletsGo runs in Docker, "localhost" means the container itself — use host.docker.internal or the compose service name.'

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return {
      reason: 'dns',
      cause: `The hostname in "${target}" could not be resolved.`,
      hint: `Check the host for typos and that this server can resolve it.${dockerNote}`,
    }
  }
  if (code === 'ECONNREFUSED') {
    return {
      reason: 'refused',
      cause: `Nothing accepted a connection on ${target}.`,
      hint: `Check that the database is running and listening on that port, and that it accepts remote connections.${dockerNote}`,
    }
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || /timed? ?out/i.test(message)) {
    return {
      reason: 'timeout',
      cause: `${target} did not answer in time.`,
      hint: 'Usually a firewall, security group or VPN silently dropping the packets — confirm this server is allowed to reach that host and port.',
    }
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ENETDOWN') {
    return {
      reason: 'network',
      cause: `No network route to ${target}.`,
      hint: 'Check the network/VPN between this server and the database host.',
    }
  }
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    return {
      reason: 'network',
      cause: `${target} closed the connection during the handshake.`,
      hint: 'Often a TLS mismatch (TLS/SSL enabled against a plain port, or the reverse) or a proxy in between — check the TLS/SSL setting.',
    }
  }
  if (/^(ERR_TLS|ERR_SSL)/.test(code) || /certificate|self.signed|ssl|tls/i.test(code)) {
    return {
      reason: 'tls',
      cause: `The TLS handshake with ${target} failed.`,
      hint: 'Verify the certificate, or relax verification (PostgreSQL: sslmode=require; Redis: TLS "insecure") if the server uses a self-signed certificate.',
    }
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return {
      reason: 'permission',
      cause: `The server is not allowed to open ${target}.`,
      hint: 'Check filesystem/socket permissions for the user the app runs as.',
    }
  }
  return null
}

/**
 * The full diagnosis for a failed attempt: the driver's own explanation when it
 * has one, otherwise the transport classification, otherwise the raw error.
 * `driver` is passed in (rather than looked up) so this module stays a leaf and
 * ./index.js keeps its one-way dependency on the drivers.
 */
export function diagnose(driver, conn, error) {
  const detail = describeError(error)
  const explained =
    driver?.explainError?.(error, conn) ||
    classifyTransport(error, conn) || {
      reason: 'unknown',
      cause: detail || 'The database rejected the connection.',
      hint: 'Open the connection settings and re-run "Test Connection" to see the full error.',
    }
  return { ...explained, code: String(codeOf(error) || '') || undefined, detail }
}
