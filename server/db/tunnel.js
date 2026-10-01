/**
 * SSH tunnels — how a connection with an `sshGatewayId` is reached.
 *
 * A tunnel is a TCP listener on 127.0.0.1:<random port> whose every socket is
 * forwarded through an SSH session on the gateway to the database's host:port.
 * The connection the driver sees is the stored one with host/port (and URI)
 * pointed at that listener, so **no driver knows tunnels exist** — and the
 * engines that shell out (pg_dump / pg_restore) work through it too, which an
 * in-process stream could not do.
 *
 * One tunnel per connection, cached for as long as the connection's handles
 * are: the session sweeper's release closes it with them. The listener's port
 * outlives a dropped SSH session (the next socket simply logs in again), so a
 * driver pool built against it never goes stale. What does invalidate it — the
 * gateway edited, the target changed — gets a fresh tunnel *and* a released
 * pool, via `signature`.
 *
 * Errors carry `sshReason` (see server/ssh.js) so the handshake's diagnosis
 * explains the tunnel rather than blaming the database.
 */

import net from 'net'
import { connectGateway, forwardOut, getSshGateway, sshError } from '../ssh.js'

const tunnels = new Map() // connection id → tunnel

// Where the database really is: the URI's host when the connection is
// URI-configured, otherwise its host/port fields.
function targetOf(conn, defaultPort) {
  if (conn.uri) {
    try {
      const u = new URL(conn.uri)
      if (u.hostname) return { host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port) || defaultPort }
    } catch {
      // fall through to the structured fields
    }
  }
  return { host: conn.host || '127.0.0.1', port: Number(conn.port) || defaultPort }
}

// The connection as the driver should dial it: everything pointed at the local
// end. `tunneledHost` keeps the real name for TLS (SNI + certificate checks),
// which would otherwise be checked against 127.0.0.1.
function dialThrough(conn, port, target) {
  const reached = { ...conn, host: '127.0.0.1', port: String(port), tunneledHost: target.host }
  if (conn.uri) {
    try {
      const u = new URL(conn.uri)
      u.hostname = '127.0.0.1'
      u.port = String(port)
      reached.uri = u.toString()
    } catch {
      // leave an unparseable URI alone; the driver will report it
    }
  }
  return reached
}

function openTunnel(gateway, target) {
  const sockets = new Set()
  let client = null
  let connecting = null

  // Log in (once, shared by concurrent callers) and prove the gateway can reach
  // the database. The probe is what turns "socket closed" — all a driver would
  // otherwise see — into "the gateway can't reach db:5432".
  const ensureSsh = () => {
    if (client) return Promise.resolve(client)
    if (!connecting) {
      connecting = (async () => {
        const c = await connectGateway(gateway)
        try {
          ;(await forwardOut(c, target.host, target.port)).destroy()
        } catch (error) {
          c.end()
          throw sshError(error, gateway, 'forward', `${target.host}:${target.port}`)
        }
        c.on('close', () => {
          if (client === c) client = null
        })
        c.on('error', () => {}) // 'close' follows; the next socket reconnects
        client = c
        return c
      })().finally(() => {
        connecting = null
      })
    }
    return connecting
  }

  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => socket.destroy())
    ensureSsh()
      .then((c) => forwardOut(c, target.host, target.port))
      .then((stream) => {
        stream.on('error', () => socket.destroy())
        socket.on('close', () => stream.destroy())
        socket.pipe(stream).pipe(socket)
      })
      .catch(() => socket.destroy())
  })

  const listening = new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })

  return {
    listening,
    ensureSsh,
    close() {
      server.close()
      for (const s of sockets) s.destroy()
      client?.end()
      client = null
    },
  }
}

// A gateway edit or a new target makes the old tunnel wrong.
const signatureOf = (gateway, target) => `${gateway.id}:${gateway.updatedAt}:${target.host}:${target.port}`

function gatewayFor(conn) {
  const gateway = getSshGateway(conn.sshGatewayId)
  if (!gateway) throw Object.assign(new Error('The SSH host this connection uses no longer exists.'), { sshReason: true, hint: 'Edit the connection and pick another SSH host, or none.' })
  return gateway
}

/**
 * The connection as its driver should dial it. Untouched when it has no
 * gateway or no network endpoint (`defaultPort` is undefined for a file-based
 * engine). Otherwise opens — or reuses — this connection's tunnel, logged in
 * and verified, and returns the connection pointed at it.
 *
 * `onStale(conn)` runs when a cached tunnel had to be replaced, so the caller
 * can drop driver handles still aimed at the old port.
 */
export async function reach(conn, defaultPort, onStale) {
  if (!conn?.sshGatewayId || !defaultPort) return conn
  const gateway = gatewayFor(conn)
  const target = targetOf(conn, defaultPort)
  const signature = signatureOf(gateway, target)
  let tunnel = tunnels.get(conn.id)
  if (tunnel && tunnel.signature !== signature) {
    closeTunnel(conn.id)
    onStale?.(conn)
    tunnel = null
  }
  if (!tunnel) {
    tunnel = { ...openTunnel(gateway, target), signature }
    tunnels.set(conn.id, tunnel)
  }
  let port
  try {
    port = await tunnel.listening
  } catch (error) {
    // No listener means nothing could be aimed at it yet; the next call retries.
    if (tunnels.get(conn.id) === tunnel) closeTunnel(conn.id)
    throw error
  }
  // A failed login keeps the listener: pools may already point at its port,
  // and the next call logs in again on the same one.
  await tunnel.ensureSsh()
  return dialThrough(conn, port, target)
}

/**
 * Run `fn` against an unsaved connection through a throwaway tunnel — the
 * "Test Connection" path, which must neither reuse nor leave behind the cache
 * entry a saved connection would.
 */
export async function withTunnel(conn, defaultPort, fn) {
  if (!conn?.sshGatewayId || !defaultPort) return fn(conn)
  const gateway = gatewayFor(conn)
  const target = targetOf(conn, defaultPort)
  const tunnel = openTunnel(gateway, target)
  try {
    const port = await tunnel.listening
    await tunnel.ensureSsh()
    return await fn(dialThrough(conn, port, target))
  } finally {
    tunnel.close()
  }
}

export function closeTunnel(connectionId) {
  const tunnel = tunnels.get(connectionId)
  if (!tunnel) return
  tunnels.delete(connectionId)
  tunnel.close()
}

export function closeAllTunnels() {
  for (const id of [...tunnels.keys()]) closeTunnel(id)
}
