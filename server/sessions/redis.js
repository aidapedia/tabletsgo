/**
 * Redis-backed session store — used when SESSION_REDIS_URL is set.
 *
 * Same contract as memory.js, so nothing above this file knows which one is
 * running. Two keys per namespace:
 *
 *   <prefix><ns>:<id>   the JSON value, with a PX expiry (Redis does the TTL)
 *   <prefix><ns>        a sorted set indexing the namespace's ids by expiry,
 *                       so `list`/`count` don't need SCAN (which is O(keyspace)
 *                       and would page over every other key in the database)
 *
 * The index is pruned by score on every read, so an entry Redis has already
 * expired never shows up in a listing.
 */

import Redis from 'ioredis'
import { SESSION_REDIS_PREFIX, SESSION_REDIS_URL } from '../config.js'

export function redisStore(url = SESSION_REDIS_URL, prefix = SESSION_REDIS_PREFIX) {
  // Sessions are read on every authenticated request: keep the client trying to
  // reconnect rather than failing permanently, but never queue commands behind
  // a dead server — a hung auth check would hang the whole request.
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    retryStrategy: (times) => Math.min(times * 300, 5000),
  })
  // ioredis emits 'error' on every failed reconnect; without a listener that
  // becomes an unhandled event and takes the process down.
  client.on('error', (err) => {
    lastError = err
  })
  let lastError = null
  let connecting = null

  // Connect on first use so a Redis that isn't up yet doesn't block boot.
  const ready = async () => {
    if (client.status === 'ready') return client
    if (!connecting) connecting = client.connect().catch((e) => { throw lastError || e }).finally(() => { connecting = null })
    await connecting
    return client
  }

  const key = (ns, id) => `${prefix}${ns}:${id}`
  const index = (ns) => `${prefix}${ns}`

  // Drop index members Redis has already expired.
  const prune = async (c, ns) => c.zremrangebyscore(index(ns), 0, Date.now())

  return {
    kind: 'redis',
    url,

    async put(ns, id, value, ttlMs) {
      const c = await ready()
      const expiresAt = Date.now() + ttlMs
      await c
        .multi()
        .set(key(ns, id), JSON.stringify(value), 'PX', ttlMs)
        .zadd(index(ns), expiresAt, id)
        .exec()
      return value
    },

    async get(ns, id) {
      const c = await ready()
      const raw = await c.get(key(ns, id))
      if (raw === null) {
        await c.zrem(index(ns), id)
        return null
      }
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    },

    async touch(ns, id, ttlMs) {
      const c = await ready()
      const ok = await c.pexpire(key(ns, id), ttlMs)
      if (!ok) {
        await c.zrem(index(ns), id)
        return false
      }
      await c.zadd(index(ns), Date.now() + ttlMs, id)
      return true
    },

    async del(ns, id) {
      const c = await ready()
      const [[, removed]] = await c.multi().del(key(ns, id)).zrem(index(ns), id).exec()
      return removed > 0
    },

    async list(ns) {
      const c = await ready()
      await prune(c, ns)
      const ids = await c.zrange(index(ns), 0, -1)
      if (!ids.length) return []
      const raws = await c.mget(ids.map((id) => key(ns, id)))
      const out = []
      const gone = []
      ids.forEach((id, i) => {
        if (raws[i] === null) return gone.push(id)
        try {
          out.push({ id, value: JSON.parse(raws[i]) })
        } catch {
          gone.push(id)
        }
      })
      if (gone.length) await c.zrem(index(ns), ...gone)
      return out
    },

    async count(ns) {
      const c = await ready()
      await prune(c, ns)
      return c.zcard(index(ns))
    },

    async clear(ns) {
      const c = await ready()
      const ids = await c.zrange(index(ns), 0, -1)
      const multi = c.multi()
      for (const id of ids) multi.del(key(ns, id))
      multi.del(index(ns))
      await multi.exec()
    },

    async close() {
      await client.quit().catch(() => client.disconnect())
    },
  }
}
