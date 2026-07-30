import { request, safeRequest } from '@/shared/api/request'

export type RedisKeyType = 'string' | 'list' | 'set' | 'zset' | 'hash' | 'stream' | 'unknown' | string

export type RedisKeyMeta = {
  key: string
  type: RedisKeyType
  /** Remaining TTL in ms, or null when the key never expires. */
  ttlMs: number | null
}

export type RedisScanPage = {
  keys: RedisKeyMeta[]
  /** Redis's own SCAN cursor — hand it back to fetch the next page. */
  cursor: string
  done: boolean
}

export type RedisKeyValue = {
  key: string
  type: RedisKeyType
  encoding: string | null
  ttlMs: number | null
  /** Byte size for a string, entry count for every collection type. */
  length: number | null
  offset: number
  limit: number
  hasMore: boolean
  columns: string[]
  rows: Record<string, unknown>[]
}

// The console's selected database rides along on `conn.ns.database` exactly like
// it does for the SQL engines, so every call is scoped to the right Redis db.
const dbParam = (conn: any) => (conn?.ns?.database ? `database=${encodeURIComponent(conn.ns.database)}` : '')
const withDb = (conn: any, path: string) => {
  const qs = dbParam(conn)
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path
}

const EMPTY_PAGE: RedisScanPage = { keys: [], cursor: '0', done: true }

/** One SCAN page of the keyspace. Degrades to an empty page on failure. */
export function scanKeys(
  conn: any,
  { pattern = '*', cursor = '0', count = 500 }: { pattern?: string; cursor?: string; count?: number } = {}
) {
  const params = new URLSearchParams({ pattern: pattern || '*', cursor, count: String(count) })
  const db = dbParam(conn)
  if (db) params.set('database', conn.ns.database)
  return safeRequest<RedisScanPage>(`/connections/${conn.id}/redis/keys?${params}`, EMPTY_PAGE)
}

/** Keyspace summary for the sidebar header. */
export function getOverview(conn: any) {
  return safeRequest<{ database: string; keyCount: number; version: string | null }>(
    withDb(conn, `/connections/${conn.id}/redis/overview`),
    { database: '', keyCount: 0, version: null }
  )
}

/** Read one key's value (paged). Throws so the key view can show one error state. */
export function readKey(conn: any, key: string, { offset = 0, limit = 200 } = {}) {
  const params = new URLSearchParams({ key, offset: String(offset), limit: String(limit) })
  if (conn?.ns?.database) params.set('database', conn.ns.database)
  return request<RedisKeyValue>(`/connections/${conn.id}/redis/key?${params}`)
}

export function deleteKeys(conn: any, keys: string[]) {
  return request<{ deleted: number }>(withDb(conn, `/connections/${conn.id}/redis/keys`), {
    method: 'DELETE',
    body: { keys },
  })
}

/** Set a key's expiry; `ttlMs` of null/0 removes it. */
export function setKeyTtl(conn: any, key: string, ttlMs: number | null) {
  return request<{ ok: true; ttlMs: number | null }>(withDb(conn, `/connections/${conn.id}/redis/ttl`), {
    method: 'PUT',
    body: { key, ttlMs },
  })
}
