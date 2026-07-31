/**
 * Sessions — who is logged in, and what the app currently holds open against a
 * database.
 *
 * Two kinds share one pluggable store, but they are stored differently because
 * they mean different things:
 *
 *   auth        one record per bearer token. Sliding TTL, refreshed on use.
 *               *Durable*: the meta DB is the source of truth (db.js), with
 *               memory — or Redis, when SESSION_REDIS_URL is set — as a cache
 *               in front (hybrid.js). A login survives a restart, a flushed
 *               cache, and a Redis outage.
 *   conn:<id>   *cache-only*, because it describes a live socket in one
 *               process: persisting it would let a restart resurrect sessions
 *               whose handles are gone. One record per *open driver handle*
 *               for a connection: the
 *               Postgres pool for a database, the ioredis client for a db
 *               index, the SQLite file handle. This is what "max sessions"
 *               counts — sessions track real connections to the database, not
 *               browser tabs, so five people browsing the same database share
 *               one session (and appear as its participants).
 *
 * A handle belongs to the process that opened it, so the local `handles` map is
 * the authority for *releasing* one; the store is the shared view that makes
 * counting and listing work across replicas. That split is why the limit is
 * best-effort under a race: two replicas can open a handle at the same instant
 * and briefly exceed `max` by one. It never under-counts, which is the side
 * that matters.
 */

import { randomUUID } from 'crypto'
import { SESSION_IDLE_TTL_MS, SESSION_REDIS_URL, SESSION_TTL_MS } from '../config.js'
import { memoryStore } from './memory.js'
import { redisStore } from './redis.js'
import { dbStore } from './db.js'
import { hybridStore } from './hybrid.js'
import { resolveMaxSessions } from './limits.js'

export { resolveMaxSessions, workspaceMaxSessions } from './limits.js'

// Which process holds a handle — shown in listings so an operator can tell one
// replica's sessions from another's.
export const INSTANCE_ID = randomUUID().slice(0, 8)

const AUTH_NS = 'auth'

// The cache layer: Redis when configured (so replicas share one), otherwise
// in-process. Either way the meta DB underneath it holds the real records, so
// swapping or losing the cache never signs anyone out.
export const cache = SESSION_REDIS_URL ? redisStore() : memoryStore()

export const store = hybridStore({ cache, source: dbStore(), durable: [AUTH_NS] })
const connNs = (connectionId) => `conn:${connectionId}`

// Raised when a connection is already at its session limit. 429 rather than 403:
// it's a capacity problem, and retrying later is the right move.
export class SessionLimitError extends Error {
  constructor(message, info) {
    super(message)
    this.name = 'SessionLimitError'
    this.status = 429
    this.info = info
  }
}

// ---- Login sessions -------------------------------------------------------

export async function createAuthSession(userId, context = {}) {
  const token = randomUUID()
  await store.put(AUTH_NS, token, { userId, createdAt: Date.now(), ...context }, SESSION_TTL_MS)
  return token
}

// Resolve a bearer token, sliding its expiry. Null when unknown or expired.
export async function readAuthSession(token) {
  if (!token) return null
  const session = await store.get(AUTH_NS, token)
  if (!session) return null
  await store.touch(AUTH_NS, token, SESSION_TTL_MS)
  return session
}

export const destroyAuthSession = (token) => (token ? store.del(AUTH_NS, token) : Promise.resolve(false))

// Sign a user out everywhere (password reset, role change, deactivation).
// Goes through the indexed `user_id` column rather than scanning every session.
export async function destroyAuthSessionsForUser(userId) {
  const ids = await store.idsForUser(userId, AUTH_NS)
  await Promise.all(ids.map((id) => store.del(AUTH_NS, id)))
  return ids.length
}

// ---- Connection sessions --------------------------------------------------

// Handles this process holds: sessionKey → { conn, ns, id, lastSeenAt }. The
// store can't own this — a handle is a live socket in one process.
const handles = new Map()

// Store writes are skipped while a session was refreshed this recently, so a
// busy console doesn't put a Redis round-trip in front of every query. Clamped
// to a third of the idle TTL: skipping for longer than the record lives would
// let a session the process is actively using expire out of the store.
const TOUCH_INTERVAL_MS = Math.max(1000, Math.min(30_000, Math.floor(SESSION_IDLE_TTL_MS / 3)))

// Called when a session is swept, so the db layer can drop the driver handle.
// Registered by server/db/index.js (a callback, not an import — sessions must
// not depend on the layer that depends on it).
let onRelease = null
export const setReleaseHandler = (fn) => {
  onRelease = fn
}

/**
 * The handle a request resolves to. One per (connection, target) — matching how
 * each driver pools: Postgres per database, Redis per db index, SQLite per file.
 */
export function sessionTarget(conn, ctx = {}) {
  if (conn.type === 'sqlite') return conn.filepath || '(file)'
  const database = ctx.database || conn.database || ''
  const schema = conn.type === 'postgresql' ? ctx.schema || 'public' : ''
  return [database || '(default)', schema].filter(Boolean).join('/')
}

const sessionId = (conn, ctx) => `${conn.type}:${sessionTarget(conn, ctx)}`
const localKey = (conn, ctx) => `${conn.id}::${sessionId(conn, ctx)}`

/**
 * Register (or refresh) the session for the handle this request needs, and
 * enforce the connection's limit before a *new* one is opened.
 *
 * Called by the db layer for every op that touches a database, so a session
 * exists for exactly as long as the app is actually using the connection —
 * no explicit "open session" step to get out of sync with reality.
 *
 * @throws {SessionLimitError} when opening a new session would exceed the limit
 */
export async function touchConnectionSession(conn, ctx = {}, actor = null) {
  if (!conn?.id) return null
  const ns = connNs(conn.id)
  const id = sessionId(conn, ctx)
  const key = localKey(conn, ctx)
  const now = Date.now()
  const local = handles.get(key)

  // Fast path: this process already holds the handle and refreshed it recently.
  if (local && now - local.lastSeenAt < TOUCH_INTERVAL_MS && (!actor || local.actors?.has(actor.id))) {
    local.lastSeenAt = now
    return local.session
  }

  const existing = await store.get(ns, id)
  if (!existing) {
    const { max, source } = resolveMaxSessions(conn)
    if (max) {
      const active = await store.count(ns)
      if (active >= max) {
        const sessions = await listConnectionSessions(conn.id)
        throw new SessionLimitError(
          `"${conn.name}" is at its limit of ${max} concurrent session${max === 1 ? '' : 's'}.`,
          { max, source, active, sessions }
        )
      }
    }
  }

  const session = {
    id,
    connectionId: conn.id,
    connectionName: conn.name,
    workspaceId: conn.workspaceId || null,
    type: conn.type,
    target: sessionTarget(conn, ctx),
    instanceId: INSTANCE_ID,
    openedAt: existing?.openedAt || now,
    lastSeenAt: now,
    participants: { ...(existing?.participants || {}) },
  }
  if (actor?.id) session.participants[actor.id] = { name: actor.name || actor.email || actor.id, lastSeenAt: now }

  await store.put(ns, id, session, SESSION_IDLE_TTL_MS)
  const actors = local?.actors || new Set()
  if (actor?.id) actors.add(actor.id)
  handles.set(key, { conn, ns, id, lastSeenAt: now, actors, session })
  return session
}

export const listConnectionSessions = async (connectionId) =>
  (await store.list(connNs(connectionId))).map((e) => e.value)

/**
 * A connection's session picture for the UI: how many are open, the cap, and
 * where that cap comes from.
 */
export async function connectionSessionStats(conn) {
  const { max, source } = resolveMaxSessions(conn)
  const sessions = await listConnectionSessions(conn.id)
  return { active: sessions.length, max, source, sessions }
}

/**
 * Leave a session. A session is shared, so an `actor` only drops their own
 * participation; the session itself ends when the last participant leaves (or
 * when called without an actor, e.g. an admin closing it outright).
 */
export async function endConnectionSession(connectionId, id, actor = null) {
  const ns = connNs(connectionId)
  const session = await store.get(ns, id)
  if (!session) return false
  if (actor?.id) {
    delete session.participants[actor.id]
    if (Object.keys(session.participants).length) {
      await store.put(ns, id, session, SESSION_IDLE_TTL_MS)
      return true
    }
  }
  await store.del(ns, id)
  await releaseLocal(connectionId, id)
  return true
}

// Drop every session for a connection — used when it's edited (credentials may
// have changed) or deleted.
export async function endAllConnectionSessions(connectionId) {
  await store.clear(connNs(connectionId))
  for (const [key, h] of handles) if (h.conn.id === connectionId) handles.delete(key)
}

// Forget the local handle and let the db layer close it.
async function releaseLocal(connectionId, id) {
  for (const [key, h] of handles) {
    if (h.conn.id !== connectionId || h.id !== id) continue
    handles.delete(key)
    // Only the last session for this connection frees the driver's handles —
    // `release` drops every pool the connection owns, not just this target.
    const others = [...handles.values()].some((o) => o.conn.id === connectionId)
    if (!others) await onRelease?.(h.conn)
  }
}

/**
 * Expire idle sessions this process holds and release their driver handles.
 * Store TTLs already hide an idle session from listings; this is what actually
 * closes the socket, and it can only run where the socket lives.
 */
export async function sweepConnectionSessions(now = Date.now()) {
  const dead = [...handles.values()].filter((h) => now - h.lastSeenAt >= SESSION_IDLE_TTL_MS)
  for (const h of dead) {
    await store.del(h.ns, h.id).catch(() => {})
    await releaseLocal(h.conn.id, h.id)
  }
  // Expired login rows are ignored on read but still occupy the table — the
  // same pass reclaims them, since SQLite has no TTL of its own.
  await store.sweepExpired().catch(() => {})
  return dead.length
}

export const closeSessionStore = () => store.close()
