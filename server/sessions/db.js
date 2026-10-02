/**
 * Durable session store — the meta DB's `sessions` table.
 *
 * This is the *source of truth* for logins. It implements the same store
 * contract as memory.js / redis.js, but unlike those it survives a restart and
 * a flushed cache, which is the whole point: a token stays valid until it
 * expires or is revoked, not until the process or the Redis it was cached in
 * happens to go away.
 *
 * It's deliberately not used on its own. Auth is checked on every request, and
 * SQLite reads on that path (plus a write for the sliding expiry) are the kind
 * of cost a cache exists to absorb — so `hybrid.js` puts memory or Redis in
 * front of it. See index.js for the wiring.
 *
 * Expiry is a plain `expires_at` column, applied on read: SQLite has no TTL, so
 * "expired" means "filtered out", and `sweepExpired()` reclaims the rows.
 */

import { db } from '../meta.js'

// `ns` keeps the contract honest for any namespace, though only 'auth' is
// stored durably today (connection sessions describe live sockets and must not
// outlive the process holding them).
const AUTH_NS = 'auth'

export function dbStore() {
  const now = () => Date.now()

  // `user_id` is a real column rather than a field inside the JSON blob so
  // "sign this user out everywhere" is an indexed delete instead of a scan of
  // every session on the instance.
  const userIdOf = (value) => (value && typeof value === 'object' ? value.userId || null : null)

  const parse = (row) => {
    if (!row) return null
    try {
      return JSON.parse(row.context)
    } catch {
      return null
    }
  }

  return {
    kind: 'db',

    async put(ns, id, value, ttlMs) {
      const row = { ns, user_id: userIdOf(value), context: JSON.stringify(value), expires_at: now() + ttlMs }
      await db().sessions.upsert({
        where: { token: id },
        create: { token: id, ...row, created_at: value?.createdAt || now() },
        update: row,
      })
      return value
    },

    async get(ns, id) {
      const row = await db().sessions.findFirst({ where: { token: id, ns }, select: { context: true, expires_at: true } })
      if (!row) return null
      if (row.expires_at <= now()) {
        await db().sessions.deleteMany({ where: { token: id } })
        return null
      }
      return parse(row)
    },

    // Slide the expiry without rewriting the value. Returns false for a session
    // that's already gone, so the caller can treat it as signed out.
    async touch(ns, id, ttlMs) {
      const { count } = await db().sessions.updateMany({
        where: { token: id, ns, expires_at: { gt: now() } },
        data: { expires_at: now() + ttlMs },
      })
      return count > 0
    },

    async del(ns, id) {
      return (await db().sessions.deleteMany({ where: { token: id, ns } })).count > 0
    },

    async list(ns) {
      return (await db().sessions.findMany({ where: { ns, expires_at: { gt: now() } }, select: { token: true, context: true } }))
        .map((r) => ({ id: r.token, value: parse(r) }))
        .filter((e) => e.value !== null)
    },

    async count(ns) {
      return db().sessions.count({ where: { ns, expires_at: { gt: now() } } })
    },

    async clear(ns) {
      await db().sessions.deleteMany({ where: { ns } })
    },

    // Every token belonging to a user — the indexed path behind
    // `destroyAuthSessionsForUser`, so signing someone out doesn't read every
    // session on the instance.
    async idsForUser(userId, ns = AUTH_NS) {
      return (await db().sessions.findMany({ where: { ns, user_id: userId }, select: { token: true } })).map((r) => r.token)
    },

    // Reclaim rows past their expiry. Reads already ignore them; this is what
    // stops the table growing without bound. Driven by the minutely sweeper.
    async sweepExpired() {
      return (await db().sessions.deleteMany({ where: { expires_at: { lte: now() } } })).count
    },

    // The meta DB's lifetime is owned by meta.js, not by this store.
    async close() {},
  }
}
