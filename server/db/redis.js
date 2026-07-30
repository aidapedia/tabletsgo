/**
 * Redis driver — connection pooling, command execution and keyspace browsing.
 *
 * Redis is not SQL, so nothing here parses statements. Instead every entry point
 * returns the *same* dialect-agnostic result shape the SQL engines return
 * (`{ type: 'rows', columns, rows }` | `{ type: 'message', message }` |
 * `{ error }`), which is what lets the existing query endpoint, workflow query
 * node and dashboard widgets work against a Redis connection unchanged.
 *
 * Everything is command-driven: the console sends whatever the user typed, and
 * the keyspace browser is built from SCAN + TYPE + TTL (never KEYS — it blocks
 * the server on large keyspaces).
 *
 * The driver object at the bottom implements the generic contract described in
 * server/db/index.js. It deliberately implements only the parts that mean
 * something for a key-value store: no tables, no columns, no diagram, no dump —
 * the generic layer answers those for the routes that ask.
 */

import { randomUUID } from 'crypto'
import Redis from 'ioredis'

// One client per (connection, db index). Redis connections are cheap but
// long-lived; ioredis reconnects on its own.
const redisClients = new Map()

// Redis numbers its databases; the app's generic `database` namespace is the
// string form ("db3"). Accept either, default to the connection's own setting.
export function redisDbIndex(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback
  const m = /^(?:db)?(\d+)$/i.exec(String(value).trim())
  return m ? parseInt(m[1], 10) : fallback
}

// Strip the `/N` database selector off a redis:// URI and report it separately.
// ioredis lets a URI's path override the `db` option, which would pin a
// URI-configured connection to one database and silently ignore the console's
// database picker — so we take the selector out of the URI and pass it as `db`.
function splitUriDb(uri) {
  try {
    const u = new URL(uri)
    const db = /^\/?(\d+)$/.exec(u.pathname)?.[1]
    u.pathname = ''
    return { uri: u.toString(), uriDb: db === undefined ? undefined : parseInt(db, 10) }
  } catch {
    return { uri, uriDb: undefined }
  }
}

// Build an ioredis config from a stored connection. `uri` (redis:// or
// rediss://) wins when present — it's what a hosted provider hands you — and the
// structured fields are the manual path. The database resolves as: the caller's
// explicit choice → the connection's own setting → the URI's path → 0.
export function redisConfig(conn, database) {
  const rawUri = (conn.uri || '').trim()
  const { uri, uriDb } = rawUri ? splitUriDb(rawUri) : { uri: '', uriDb: undefined }
  const db = redisDbIndex(database, redisDbIndex(conn.database, uriDb ?? 0))
  const common = {
    db,
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 10000,
    // Fail fast instead of queueing commands forever behind a dead server.
    enableOfflineQueue: false,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
  }
  if (uri) return { uri, options: common }

  const noAuth = conn.auth === 'none'
  return {
    options: {
      ...common,
      host: conn.host || '127.0.0.1',
      port: parseInt(conn.port) || 6379,
      username: noAuth ? undefined : conn.username || undefined,
      password: noAuth ? undefined : conn.password || undefined,
      // `tls` is Redis's equivalent of the SQL connections' sslmode.
      tls: conn.tls ? { rejectUnauthorized: conn.tls !== 'insecure' } : undefined,
    },
  }
}

// Pooled client for a connection + database, connected on first use. Throws the
// underlying connection error (rather than hanging) when the server is
// unreachable, so callers surface a real message. The pool key uses the *fully
// resolved* db (which may come from the URI), so a client is never handed back
// for a database it isn't actually on.
export async function getRedisClient(conn, database) {
  const cfg = redisConfig(conn, database)
  const key = `${conn.id}::${cfg.options.db}`
  if (!redisClients.has(key)) {
    const client = cfg.uri ? new Redis(cfg.uri, cfg.options) : new Redis(cfg.options)
    // ioredis emits 'error' on every failed reconnect; without a listener that
    // becomes an unhandled event and crashes the process. Keep the last one:
    // once the client gives up, `connect()` rejects with a generic "Connection
    // is closed", and this is where the real cause (ECONNREFUSED, WRONGPASS,
    // ENOTFOUND, …) actually shows up.
    client.on('error', (err) => {
      client.lastSocketError = err
    })
    client.on('ready', () => {
      client.lastSocketError = null
    })
    redisClients.set(key, client)
  }
  const client = redisClients.get(key)
  if (client.status === 'end' || client.status === 'close') {
    // A client that gave up reconnecting can't be revived — replace it.
    redisClients.delete(key)
    client.disconnect()
    return getRedisClient(conn, database)
  }
  if (client.status !== 'ready') {
    await client.connect().catch((e) => {
      if (client.status === 'ready') return
      throw client.lastSocketError || e
    })
  }
  return client
}

export function closeRedisClients(id) {
  for (const [key, client] of redisClients) {
    if (key === id || key.startsWith(`${id}::`)) {
      client.disconnect()
      redisClients.delete(key)
    }
  }
}

export function closeAllRedisClients() {
  for (const [, client] of redisClients) client.disconnect()
  redisClients.clear()
}

// ---- Command parsing -------------------------------------------------------

// Split one command line into [command, ...args], honouring single/double quotes
// and backslash escapes the way redis-cli does. Unterminated quotes are an error
// rather than a silently truncated argument.
export function parseCommandLine(line) {
  const tokens = []
  let token = ''
  let quote = null
  let started = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === '\\' && i + 1 < line.length) {
        token += line[++i]
      } else if (ch === quote && line[i + 1] === quote) {
        // Doubled quote = one literal quote. redis-cli doesn't accept this, but
        // SQL does — and the workflow query node renders {{input.x}} as a SQL
        // literal for every dialect, so a value containing a quote arrives here
        // in that form.
        token += ch
        i++
      } else if (ch === quote) {
        quote = null
      } else {
        token += ch
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      started = true
      continue
    }
    if (/\s/.test(ch)) {
      if (started) tokens.push(token)
      token = ''
      started = false
      continue
    }
    token += ch
    started = true
  }
  if (quote) throw new Error('Unterminated quote in command.')
  if (started) tokens.push(token)
  return tokens
}

// Split a console buffer into individual commands: one per line, `#` comments
// and blank lines dropped. Semicolons are NOT separators — they're legal inside
// Redis keys and values.
export function splitCommands(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

// Commands that would wedge the server or the console: blocking reads (they hold
// the connection until data arrives), pub/sub modes (the client never returns to
// normal command mode), and MONITOR (a firehose with no end).
const BLOCKED_COMMANDS = new Set([
  'subscribe', 'psubscribe', 'ssubscribe', 'unsubscribe', 'punsubscribe', 'sunsubscribe',
  'monitor', 'blpop', 'brpop', 'blmove', 'blmpop', 'brpoplpush', 'bzpopmin', 'bzpopmax',
  'bzmpop', 'wait', 'sync', 'psync', 'reset',
])

// ---- Reply normalization ---------------------------------------------------

const asText = (v) => (Buffer.isBuffer(v) ? v.toString('utf8') : v)

// Render a nested reply as a compact, readable scalar for a grid cell.
function flatten(v) {
  const value = asText(v)
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return JSON.stringify(value.map(flatten))
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

// Turn one Redis reply into the app's generic result shape. The mapping favours
// the grid (rows) whenever a reply is a collection, and the message box for the
// scalar status/integer/nil replies where a one-cell table would be noise.
export function normalizeReply(reply) {
  const value = asText(reply)
  if (value === null || value === undefined) return { type: 'message', message: '(nil)' }
  if (typeof value === 'number' || typeof value === 'bigint') return { type: 'message', message: `(integer) ${value}` }
  if (typeof value === 'boolean') return { type: 'message', message: value ? '1' : '0' }

  if (typeof value === 'string') {
    // Multi-line payloads (INFO, CLIENT LIST, LATENCY DOCTOR, …) read far better
    // as one row per line than as a wall of text in the message box.
    if (value.includes('\n')) {
      const rows = value
        .split(/\r?\n/)
        .filter((l) => l.length)
        .map((line) => ({ line }))
      return { type: 'rows', columns: ['line'], rows }
    }
    return { type: 'message', message: value }
  }

  if (Array.isArray(value)) {
    if (!value.length) return { type: 'message', message: '(empty list or set)' }
    return {
      type: 'rows',
      columns: ['#', 'value'],
      rows: value.map((v, i) => ({ '#': i + 1, value: flatten(v) })),
    }
  }

  // ioredis returns map replies (HGETALL, CONFIG GET, XPENDING summaries) as
  // plain objects.
  const entries = Object.entries(value)
  if (!entries.length) return { type: 'message', message: '(empty hash)' }
  return {
    type: 'rows',
    columns: ['field', 'value'],
    rows: entries.map(([field, v]) => ({ field, value: flatten(v) })),
  }
}

// ---- Command execution -----------------------------------------------------

// Run whatever the console sent. A single command gets the rich normalized
// result; a batch gets one summary row per command so a partial failure is
// visible instead of aborting the run.
export async function runRedisCommand(client, text) {
  const lines = splitCommands(text)
  if (!lines.length) return { error: 'No command to run.' }

  if (lines.length === 1) {
    try {
      return normalizeReply(await execOne(client, lines[0]))
    } catch (error) {
      return { error: error.message }
    }
  }

  const rows = []
  for (const [i, line] of lines.entries()) {
    try {
      const reply = await execOne(client, line)
      rows.push({ '#': i + 1, command: line, status: 'OK', reply: flatten(reply) ?? '(nil)' })
    } catch (error) {
      rows.push({ '#': i + 1, command: line, status: 'ERROR', reply: error.message })
    }
  }
  return { type: 'rows', columns: ['#', 'command', 'status', 'reply'], rows }
}

async function execOne(client, line) {
  const [command, ...args] = parseCommandLine(line)
  if (!command) throw new Error('Empty command.')
  const name = command.toLowerCase()
  if (BLOCKED_COMMANDS.has(name)) {
    throw new Error(`${command.toUpperCase()} is not supported here — it holds the connection open indefinitely.`)
  }
  return client.call(name, ...args)
}

// ---- Keyspace browsing -----------------------------------------------------

// One SCAN page, enriched with each key's type and TTL (pipelined — two extra
// round-trip-free commands per key). `cursor` is Redis's own opaque cursor, so
// the caller pages by handing back what it got.
export async function scanRedisKeys(client, { pattern = '*', cursor = '0', count = 300, type } = {}) {
  const args = ['MATCH', pattern || '*', 'COUNT', String(Math.min(Math.max(parseInt(count) || 300, 10), 5000))]
  if (type) args.push('TYPE', type)
  const [next, keys] = await client.scan(cursor || '0', ...args)

  if (!keys.length) return { keys: [], cursor: next, done: next === '0' }

  const pipe = client.pipeline()
  for (const key of keys) {
    pipe.type(key)
    pipe.pttl(key)
  }
  const replies = await pipe.exec()

  const out = keys.map((key, i) => {
    const [typeErr, keyType] = replies[i * 2] || []
    const [ttlErr, pttl] = replies[i * 2 + 1] || []
    return {
      key,
      type: typeErr ? 'unknown' : keyType,
      // -1 = no expiry, -2 = the key vanished between SCAN and PTTL.
      ttlMs: ttlErr || pttl < 0 ? null : pttl,
    }
  })
  return { keys: out, cursor: next, done: next === '0' }
}

// Cardinality of a collection key (the "how many entries" the browser shows).
async function keyLength(client, key, type) {
  switch (type) {
    case 'string': return client.strlen(key)
    case 'list': return client.llen(key)
    case 'set': return client.scard(key)
    case 'zset': return client.zcard(key)
    case 'hash': return client.hlen(key)
    case 'stream': return client.xlen(key)
    default: return null
  }
}

// Read one key's value as a generic { columns, rows } page. Every collection
// type is paged by offset/limit so a million-element list can still be opened.
export async function readRedisKey(client, key, { offset = 0, limit = 200 } = {}) {
  const type = await client.type(key)
  if (type === 'none') throw new Error(`Key "${key}" does not exist.`)

  const start = Math.max(parseInt(offset) || 0, 0)
  const take = Math.min(Math.max(parseInt(limit) || 200, 1), 5000)
  const stop = start + take - 1

  const [pttl, length, encoding] = await Promise.all([
    client.pttl(key),
    keyLength(client, key, type),
    client.object('ENCODING', key).catch(() => null),
  ])

  let columns = []
  let rows = []
  switch (type) {
    case 'string': {
      const value = await client.get(key)
      columns = ['value']
      rows = [{ value }]
      break
    }
    case 'list': {
      const items = await client.lrange(key, start, stop)
      columns = ['index', 'value']
      rows = items.map((value, i) => ({ index: start + i, value }))
      break
    }
    case 'set': {
      // SMEMBERS is O(N) over the whole set; SSCAN pages it. The cursor isn't
      // an offset, so we walk pages until we've filled the requested window.
      const members = await sscanWindow(client, key, start, take)
      columns = ['#', 'member']
      rows = members.map((member, i) => ({ '#': start + i + 1, member }))
      break
    }
    case 'zset': {
      const flat = await client.zrange(key, start, stop, 'WITHSCORES')
      columns = ['rank', 'member', 'score']
      rows = []
      for (let i = 0; i < flat.length; i += 2) {
        rows.push({ rank: start + i / 2 + 1, member: flat[i], score: flat[i + 1] })
      }
      break
    }
    case 'hash': {
      const all = await client.hgetall(key)
      columns = ['field', 'value']
      rows = Object.entries(all)
        .slice(start, start + take)
        .map(([field, value]) => ({ field, value }))
      break
    }
    case 'stream': {
      const entries = await client.xrange(key, '-', '+', 'COUNT', start + take)
      columns = ['id', 'fields']
      rows = entries.slice(start).map(([id, fields]) => {
        const obj = {}
        for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1]
        return { id, fields: JSON.stringify(obj) }
      })
      break
    }
    default: {
      // Module types (JSON, TimeSeries, Bloom, …) — report rather than guess.
      columns = ['value']
      rows = [{ value: `Unsupported key type "${type}" — inspect it from the console.` }]
    }
  }

  return {
    key,
    type,
    encoding,
    ttlMs: pttl < 0 ? null : pttl,
    // For a string, `length` is its size in bytes (there's one row, never paged);
    // for every collection type it's the entry count that `rows` pages through.
    length,
    offset: start,
    limit: take,
    hasMore: type !== 'string' && length != null && start + rows.length < length,
    columns,
    rows,
  }
}

// Collect a [start, start+take) window of a set via SSCAN. Bounded by a page
// budget so a pathological set can't spin the request forever.
async function sscanWindow(client, key, start, take) {
  const seen = []
  let cursor = '0'
  let pages = 0
  do {
    const [next, batch] = await client.sscan(key, cursor, 'COUNT', 500)
    seen.push(...batch)
    cursor = next
    pages += 1
  } while (cursor !== '0' && seen.length < start + take && pages < 200)
  return seen.slice(start, start + take)
}

// Databases available on the server, for the console's namespace breadcrumb.
// `databases` reads as db0…dbN; Redis has no schema concept, so that list is
// empty and the UI hides the schema picker.
export async function redisNamespaces(client) {
  let count = 16
  try {
    const cfg = await client.config('GET', 'databases')
    const n = parseInt(Array.isArray(cfg) ? cfg[1] : cfg?.databases, 10)
    if (Number.isFinite(n) && n > 0) count = n
  } catch {
    // Managed Redis (and Redis Cloud) often disable CONFIG — fall back to 16.
  }
  return {
    databases: Array.from({ length: count }, (_, i) => `db${i}`),
    schemas: [],
    currentDatabase: `db${client.options.db || 0}`,
  }
}

// Server/keyspace summary shown above the key tree.
export async function redisOverview(client) {
  const db = client.options.db || 0
  const [size, info] = await Promise.all([
    client.dbsize(),
    client.info('server').catch(() => ''),
  ])
  const version = /redis_version:([^\r\n]+)/.exec(info || '')?.[1] || null
  return { database: `db${db}`, keyCount: size, version }
}

// ---- Driver ----------------------------------------------------------------

export const redisDriver = {
  type: 'redis',
  label: 'Redis',
  // Schemaless — the schema designer is hidden for connections that report none.
  dataTypes: [],

  async testConnection(config) {
    // Probe under a throwaway id so the pooled client (and its reconnect loop)
    // is discarded with the request — the form may be testing a bad host.
    const probeId = `test:${randomUUID()}`
    try {
      const client = await getRedisClient({ ...config, id: probeId })
      // `database` comes back from the client, not the form — a redis:// URI
      // can carry its own db selector.
      const { keyCount, version, database } = await redisOverview(client)
      return { ok: true, message: `Connected to Redis${version ? ` ${version}` : ''} · ${keyCount} key(s) in ${database}.` }
    } finally {
      closeRedisClients(probeId)
    }
  },

  release: (conn) => closeRedisClients(conn.id),
  closeAll: () => closeAllRedisClients(),

  async ping(conn, ctx) {
    await (await client(conn, ctx)).ping()
    return { ok: true }
  },

  namespaces: async (conn, ctx) => redisNamespaces(await client(conn, ctx)),

  runQuery: async (conn, ctx, text) => runRedisCommand(await client(conn, ctx), text),

  // ---- Keyspace browsing (no SQL equivalent — see the /redis/* routes) ----
  overview: async (conn, ctx) => redisOverview(await client(conn, ctx)),

  scanKeys: async (conn, ctx, options) => scanRedisKeys(await client(conn, ctx), options),

  readKey: async (conn, ctx, key, window) => readRedisKey(await client(conn, ctx), key, window),

  deleteKeys: async (conn, ctx, keys) => ({ deleted: await (await client(conn, ctx)).del(...keys) }),

  async setTtl(conn, ctx, key, ttlMs) {
    const c = await client(conn, ctx)
    const ms = Number(ttlMs)
    const clear = !ms || ms <= 0
    const ok = clear ? await c.persist(key) : await c.pexpire(key, Math.round(ms))
    if (!ok) throw Object.assign(new Error(`Key "${key}" does not exist or already has no expiry.`), { status: 400 })
    return { ok: true, ttlMs: clear ? null : Math.round(ms) }
  },
}

const client = (conn, ctx) => getRedisClient(conn, ctx?.database)
