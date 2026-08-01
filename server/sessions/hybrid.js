/**
 * Composes two stores into one: a durable `source` (the meta DB) with a fast
 * in-process `cache` in front.
 *
 * Only the namespaces listed in `durable` go through the source. Everything
 * else is cache-only, and that split is deliberate:
 *
 *   auth        durable. A login must outlive a restart and a flushed cache.
 *   conn:<id>   cache-only. A connection session describes a *live driver
 *               handle* in one process. Persisting it would mean a restart
 *               resurrecting sessions whose sockets are long gone, and the
 *               limit counting phantoms. Losing them on restart is correct.
 *
 * The rules for a durable namespace:
 *   - the source is written first, then the cache. A crash between the two
 *     leaves a valid session that simply isn't cached yet.
 *   - a cache miss falls through to the source and backfills.
 *   - `list`/`count` always read the source: the cache is allowed to be a
 *     partial view, so counting it would under-report.
 *   - a cache failure is never fatal (see `viaCache`). Redis going down should
 *     make auth slower, not sign everyone out.
 *
 * The cache TTL is capped at CACHE_TTL_MS so a cached copy can't outlive the
 * source's view of it by long — the source is what gets asked once it lapses.
 */

// How long a durable entry may sit in the cache before it's re-read from the
// source. Short enough that an out-of-band revocation (another replica calling
// `del`, a row deleted by hand) takes effect quickly, long enough that the
// common case never touches SQLite.
const CACHE_TTL_MS = 60_000

/**
 * Sliding expiry would otherwise mean a DB write on every authenticated
 * request. The source is only rewritten once the entry has burned through this
 * fraction of its TTL — so a 30-day login is persisted at most once a day,
 * while the cache keeps sliding on every request as before.
 */
const PERSIST_AFTER = 0.1

export function hybridStore({ cache, source, durable = ['auth'] }) {
  const durableNs = new Set(durable)
  const isDurable = (ns) => durableNs.has(ns)

  // When the source expires an entry, so must the cache.
  const cacheTtl = (ttlMs) => Math.min(ttlMs, CACHE_TTL_MS)

  // A cache is an optimization, never a dependency: if Redis is unreachable the
  // request should still be answered from the source.
  const viaCache = async (op, fallback = null) => {
    try {
      return await op()
    } catch (error) {
      if (!warned) {
        console.error('Session cache unavailable, falling back to the database:', error.message)
        warned = true
      }
      return fallback
    }
  }
  let warned = false

  // Remaining lifetime, per the cache's own view — used to decide whether the
  // source's expiry has drifted far enough to be worth a write.
  const persistedAt = new Map()

  return {
    kind: `${source.kind}+${cache.kind}`,
    cacheKind: cache.kind,
    sourceKind: source.kind,

    async put(ns, id, value, ttlMs) {
      if (!isDurable(ns)) return cache.put(ns, id, value, ttlMs)
      await source.put(ns, id, value, ttlMs)
      persistedAt.set(id, Date.now())
      await viaCache(() => cache.put(ns, id, value, cacheTtl(ttlMs)))
      return value
    },

    async get(ns, id) {
      if (!isDurable(ns)) return cache.get(ns, id)
      const hit = await viaCache(() => cache.get(ns, id))
      if (hit) return hit
      const value = await source.get(ns, id)
      if (value) await viaCache(() => cache.put(ns, id, value, cacheTtl(CACHE_TTL_MS)))
      return value
    },

    async touch(ns, id, ttlMs) {
      if (!isDurable(ns)) return cache.touch(ns, id, ttlMs)
      // Slide the cache every time — it's cheap and keeps the hot copy alive.
      await viaCache(() => cache.touch(ns, id, cacheTtl(ttlMs)))
      const last = persistedAt.get(id) || 0
      if (Date.now() - last < ttlMs * PERSIST_AFTER) return true
      const ok = await source.touch(ns, id, ttlMs)
      if (ok) persistedAt.set(id, Date.now())
      // The source is the authority: if the row is gone the session has been
      // revoked, so drop the cached copy rather than letting it keep answering.
      else await viaCache(() => cache.del(ns, id))
      return ok
    },

    async del(ns, id) {
      if (!isDurable(ns)) return cache.del(ns, id)
      persistedAt.delete(id)
      const removed = await source.del(ns, id)
      await viaCache(() => cache.del(ns, id))
      return removed
    },

    // Listings come from the source — the cache is a partial view by design.
    async list(ns) {
      return isDurable(ns) ? source.list(ns) : cache.list(ns)
    },

    async count(ns) {
      return isDurable(ns) ? source.count(ns) : cache.count(ns)
    },

    async clear(ns) {
      if (!isDurable(ns)) return cache.clear(ns)
      await source.clear(ns)
      await viaCache(() => cache.clear(ns))
    },

    // Evict specific ids from the cache after the source changed underneath it
    // (e.g. signing a user out of every session at once).
    async invalidate(ns, ids) {
      for (const id of ids) persistedAt.delete(id)
      await viaCache(() => Promise.all(ids.map((id) => cache.del(ns, id))))
    },

    async sweepExpired() {
      return source.sweepExpired?.() ?? 0
    },

    async idsForUser(userId, ns) {
      return source.idsForUser?.(userId, ns) ?? []
    },

    async close() {
      await cache.close()
      await source.close()
    },
  }
}
