/**
 * In-process session store — the cache layer under sessions/index.js.
 *
 * Fast and dependency-free, with the limit that comes with it: what lives only
 * here is lost on restart and invisible to another replica. That's why logins
 * are durable in the meta DB (hybrid.js) and only connection sessions — which
 * describe this process's own live handles — are cache-only.
 */

// namespace → Map<id, { value, expiresAt }>
const namespaces = new Map()

const bucket = (ns) => {
  if (!namespaces.has(ns)) namespaces.set(ns, new Map())
  return namespaces.get(ns)
}

const live = (entry) => !!entry && entry.expiresAt > Date.now()

export function memoryStore() {
  return {
    kind: 'memory',

    async put(ns, id, value, ttlMs) {
      bucket(ns).set(id, { value, expiresAt: Date.now() + ttlMs })
      return value
    },

    async get(ns, id) {
      const entry = bucket(ns).get(id)
      if (!live(entry)) {
        bucket(ns).delete(id)
        return null
      }
      return entry.value
    },

    // Extend the lifetime without rewriting the value (sliding expiry).
    async touch(ns, id, ttlMs) {
      const entry = bucket(ns).get(id)
      if (!live(entry)) return false
      entry.expiresAt = Date.now() + ttlMs
      return true
    },

    async del(ns, id) {
      return bucket(ns).delete(id)
    },

    // Every live entry in the namespace, expired ones dropped on the way out.
    async list(ns) {
      const out = []
      for (const [id, entry] of bucket(ns)) {
        if (live(entry)) out.push({ id, value: entry.value })
        else bucket(ns).delete(id)
      }
      return out
    },

    async count(ns) {
      return (await this.list(ns)).length
    },

    async clear(ns) {
      namespaces.delete(ns)
    },

    async close() {
      namespaces.clear()
    },
  }
}
