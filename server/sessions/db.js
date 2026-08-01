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

import { meta } from '../meta.js'

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
      meta
        .prepare(
          `INSERT INTO sessions (token, ns, user_id, context, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(token) DO UPDATE SET
             ns = excluded.ns, user_id = excluded.user_id,
             context = excluded.context, expires_at = excluded.expires_at`
        )
        .run(id, ns, userIdOf(value), JSON.stringify(value), value?.createdAt || now(), now() + ttlMs)
      return value
    },

    async get(ns, id) {
      const row = meta.prepare('SELECT context, expires_at FROM sessions WHERE token = ? AND ns = ?').get(id, ns)
      if (!row) return null
      if (row.expires_at <= now()) {
        meta.prepare('DELETE FROM sessions WHERE token = ?').run(id)
        return null
      }
      return parse(row)
    },

    // Slide the expiry without rewriting the value. Returns false for a session
    // that's already gone, so the caller can treat it as signed out.
    async touch(ns, id, ttlMs) {
      const changes = meta
        .prepare('UPDATE sessions SET expires_at = ? WHERE token = ? AND ns = ? AND expires_at > ?')
        .run(now() + ttlMs, id, ns, now()).changes
      return changes > 0
    },

    async del(ns, id) {
      return meta.prepare('DELETE FROM sessions WHERE token = ? AND ns = ?').run(id, ns).changes > 0
    },

    async list(ns) {
      return meta
        .prepare('SELECT token, context FROM sessions WHERE ns = ? AND expires_at > ?')
        .all(ns, now())
        .map((r) => ({ id: r.token, value: parse(r) }))
        .filter((e) => e.value !== null)
    },

    async count(ns) {
      return meta.prepare('SELECT COUNT(*) c FROM sessions WHERE ns = ? AND expires_at > ?').get(ns, now()).c
    },

    async clear(ns) {
      meta.prepare('DELETE FROM sessions WHERE ns = ?').run(ns)
    },

    // Every token belonging to a user — the indexed path behind
    // `destroyAuthSessionsForUser`, so signing someone out doesn't read every
    // session on the instance.
    async idsForUser(userId, ns = AUTH_NS) {
      return meta
        .prepare('SELECT token FROM sessions WHERE ns = ? AND user_id = ?')
        .all(ns, userId)
        .map((r) => r.token)
    },

    // Reclaim rows past their expiry. Reads already ignore them; this is what
    // stops the table growing without bound. Driven by the minutely sweeper.
    async sweepExpired() {
      return meta.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now()).changes
    },

    // The meta DB's lifetime is owned by meta.js, not by this store.
    async close() {},
  }
}
