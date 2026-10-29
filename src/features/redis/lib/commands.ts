/**
 * Redis command catalog — powers the console's autocomplete and its inline
 * argument hint. Deliberately a plain data table rather than a fetch of
 * `COMMAND DOCS`: it works offline, before a connection is up, and on servers
 * that restrict introspection.
 *
 * Not exhaustive (Redis ships ~250 commands and a long tail of module ones) —
 * anything missing still runs, it just isn't suggested.
 */

export type RedisCommandSpec = {
  name: string
  /** Argument template shown next to the suggestion, redis.io style. */
  args: string
  group: string
  /** The Redis version that introduced it (from the server's own COMMAND DOCS). */
  since: string
}

export const REDIS_COMMANDS: RedisCommandSpec[] = [
  // Keys
  { name: 'DEL', args: 'key [key ...]', group: 'generic', since: '1.0.0' },
  { name: 'UNLINK', args: 'key [key ...]', group: 'generic', since: '4.0.0' },
  { name: 'EXISTS', args: 'key [key ...]', group: 'generic', since: '1.0.0' },
  { name: 'EXPIRE', args: 'key seconds', group: 'generic', since: '1.0.0' },
  { name: 'PEXPIRE', args: 'key milliseconds', group: 'generic', since: '2.6.0' },
  { name: 'EXPIREAT', args: 'key unix-time-seconds', group: 'generic', since: '1.2.0' },
  { name: 'TTL', args: 'key', group: 'generic', since: '1.0.0' },
  { name: 'PTTL', args: 'key', group: 'generic', since: '2.6.0' },
  { name: 'PERSIST', args: 'key', group: 'generic', since: '2.2.0' },
  { name: 'RENAME', args: 'key newkey', group: 'generic', since: '1.0.0' },
  { name: 'RENAMENX', args: 'key newkey', group: 'generic', since: '1.0.0' },
  { name: 'TYPE', args: 'key', group: 'generic', since: '1.0.0' },
  { name: 'SCAN', args: 'cursor [MATCH pattern] [COUNT count] [TYPE type]', group: 'generic', since: '2.8.0' },
  { name: 'KEYS', args: 'pattern', group: 'generic', since: '1.0.0' },
  { name: 'RANDOMKEY', args: '', group: 'generic', since: '1.0.0' },
  { name: 'TOUCH', args: 'key [key ...]', group: 'generic', since: '3.2.1' },
  { name: 'COPY', args: 'source destination [DB index] [REPLACE]', group: 'generic', since: '6.2.0' },
  { name: 'DUMP', args: 'key', group: 'generic', since: '2.6.0' },
  { name: 'RESTORE', args: 'key ttl serialized-value [REPLACE]', group: 'generic', since: '2.6.0' },
  { name: 'OBJECT', args: 'ENCODING|FREQ|IDLETIME|REFCOUNT key', group: 'generic', since: '2.2.3' },
  { name: 'SORT', args: 'key [BY pattern] [LIMIT offset count] [ASC|DESC] [ALPHA]', group: 'generic', since: '1.0.0' },

  // Strings
  { name: 'GET', args: 'key', group: 'string', since: '1.0.0' },
  { name: 'SET', args: 'key value [EX seconds|PX ms] [NX|XX] [KEEPTTL] [GET]', group: 'string', since: '1.0.0' },
  { name: 'SETNX', args: 'key value', group: 'string', since: '1.0.0' },
  { name: 'SETEX', args: 'key seconds value', group: 'string', since: '2.0.0' },
  { name: 'PSETEX', args: 'key milliseconds value', group: 'string', since: '2.6.0' },
  { name: 'GETSET', args: 'key value', group: 'string', since: '1.0.0' },
  { name: 'GETDEL', args: 'key', group: 'string', since: '6.2.0' },
  { name: 'GETEX', args: 'key [EX seconds|PERSIST]', group: 'string', since: '6.2.0' },
  { name: 'MGET', args: 'key [key ...]', group: 'string', since: '1.0.0' },
  { name: 'MSET', args: 'key value [key value ...]', group: 'string', since: '1.0.1' },
  { name: 'MSETNX', args: 'key value [key value ...]', group: 'string', since: '1.0.1' },
  { name: 'APPEND', args: 'key value', group: 'string', since: '2.0.0' },
  { name: 'STRLEN', args: 'key', group: 'string', since: '2.2.0' },
  { name: 'INCR', args: 'key', group: 'string', since: '1.0.0' },
  { name: 'DECR', args: 'key', group: 'string', since: '1.0.0' },
  { name: 'INCRBY', args: 'key increment', group: 'string', since: '1.0.0' },
  { name: 'DECRBY', args: 'key decrement', group: 'string', since: '1.0.0' },
  { name: 'INCRBYFLOAT', args: 'key increment', group: 'string', since: '2.6.0' },
  { name: 'GETRANGE', args: 'key start end', group: 'string', since: '2.4.0' },
  { name: 'SETRANGE', args: 'key offset value', group: 'string', since: '2.2.0' },

  // Hashes
  { name: 'HGET', args: 'key field', group: 'hash', since: '2.0.0' },
  { name: 'HSET', args: 'key field value [field value ...]', group: 'hash', since: '2.0.0' },
  { name: 'HSETNX', args: 'key field value', group: 'hash', since: '2.0.0' },
  { name: 'HDEL', args: 'key field [field ...]', group: 'hash', since: '2.0.0' },
  { name: 'HGETALL', args: 'key', group: 'hash', since: '2.0.0' },
  { name: 'HKEYS', args: 'key', group: 'hash', since: '2.0.0' },
  { name: 'HVALS', args: 'key', group: 'hash', since: '2.0.0' },
  { name: 'HLEN', args: 'key', group: 'hash', since: '2.0.0' },
  { name: 'HEXISTS', args: 'key field', group: 'hash', since: '2.0.0' },
  { name: 'HMGET', args: 'key field [field ...]', group: 'hash', since: '2.0.0' },
  { name: 'HINCRBY', args: 'key field increment', group: 'hash', since: '2.0.0' },
  { name: 'HINCRBYFLOAT', args: 'key field increment', group: 'hash', since: '2.6.0' },
  { name: 'HRANDFIELD', args: 'key [count [WITHVALUES]]', group: 'hash', since: '6.2.0' },
  { name: 'HSCAN', args: 'key cursor [MATCH pattern] [COUNT count]', group: 'hash', since: '2.8.0' },

  // Lists
  { name: 'LPUSH', args: 'key element [element ...]', group: 'list', since: '1.0.0' },
  { name: 'RPUSH', args: 'key element [element ...]', group: 'list', since: '1.0.0' },
  { name: 'LPUSHX', args: 'key element [element ...]', group: 'list', since: '2.2.0' },
  { name: 'RPUSHX', args: 'key element [element ...]', group: 'list', since: '2.2.0' },
  { name: 'LPOP', args: 'key [count]', group: 'list', since: '1.0.0' },
  { name: 'RPOP', args: 'key [count]', group: 'list', since: '1.0.0' },
  { name: 'LRANGE', args: 'key start stop', group: 'list', since: '1.0.0' },
  { name: 'LLEN', args: 'key', group: 'list', since: '1.0.0' },
  { name: 'LINDEX', args: 'key index', group: 'list', since: '1.0.0' },
  { name: 'LSET', args: 'key index element', group: 'list', since: '1.0.0' },
  { name: 'LINSERT', args: 'key BEFORE|AFTER pivot element', group: 'list', since: '2.2.0' },
  { name: 'LREM', args: 'key count element', group: 'list', since: '1.0.0' },
  { name: 'LTRIM', args: 'key start stop', group: 'list', since: '1.0.0' },
  { name: 'LMOVE', args: 'source destination LEFT|RIGHT LEFT|RIGHT', group: 'list', since: '6.2.0' },
  { name: 'LPOS', args: 'key element [RANK rank] [COUNT count]', group: 'list', since: '6.0.6' },

  // Sets
  { name: 'SADD', args: 'key member [member ...]', group: 'set', since: '1.0.0' },
  { name: 'SREM', args: 'key member [member ...]', group: 'set', since: '1.0.0' },
  { name: 'SMEMBERS', args: 'key', group: 'set', since: '1.0.0' },
  { name: 'SISMEMBER', args: 'key member', group: 'set', since: '1.0.0' },
  { name: 'SMISMEMBER', args: 'key member [member ...]', group: 'set', since: '6.2.0' },
  { name: 'SCARD', args: 'key', group: 'set', since: '1.0.0' },
  { name: 'SPOP', args: 'key [count]', group: 'set', since: '1.0.0' },
  { name: 'SRANDMEMBER', args: 'key [count]', group: 'set', since: '1.0.0' },
  { name: 'SMOVE', args: 'source destination member', group: 'set', since: '1.0.0' },
  { name: 'SDIFF', args: 'key [key ...]', group: 'set', since: '1.0.0' },
  { name: 'SINTER', args: 'key [key ...]', group: 'set', since: '1.0.0' },
  { name: 'SUNION', args: 'key [key ...]', group: 'set', since: '1.0.0' },
  { name: 'SDIFFSTORE', args: 'destination key [key ...]', group: 'set', since: '1.0.0' },
  { name: 'SINTERSTORE', args: 'destination key [key ...]', group: 'set', since: '1.0.0' },
  { name: 'SUNIONSTORE', args: 'destination key [key ...]', group: 'set', since: '1.0.0' },
  { name: 'SSCAN', args: 'key cursor [MATCH pattern] [COUNT count]', group: 'set', since: '2.8.0' },

  // Sorted sets
  { name: 'ZADD', args: 'key [NX|XX] [GT|LT] [CH] [INCR] score member ...', group: 'zset', since: '1.2.0' },
  { name: 'ZREM', args: 'key member [member ...]', group: 'zset', since: '1.2.0' },
  { name: 'ZSCORE', args: 'key member', group: 'zset', since: '1.2.0' },
  { name: 'ZMSCORE', args: 'key member [member ...]', group: 'zset', since: '6.2.0' },
  { name: 'ZCARD', args: 'key', group: 'zset', since: '1.2.0' },
  { name: 'ZCOUNT', args: 'key min max', group: 'zset', since: '2.0.0' },
  { name: 'ZINCRBY', args: 'key increment member', group: 'zset', since: '1.2.0' },
  { name: 'ZRANGE', args: 'key start stop [BYSCORE|BYLEX] [REV] [LIMIT offset count] [WITHSCORES]', group: 'zset', since: '1.2.0' },
  { name: 'ZREVRANGE', args: 'key start stop [WITHSCORES]', group: 'zset', since: '1.2.0' },
  { name: 'ZRANGEBYSCORE', args: 'key min max [WITHSCORES] [LIMIT offset count]', group: 'zset', since: '1.0.5' },
  { name: 'ZRANK', args: 'key member [WITHSCORE]', group: 'zset', since: '2.0.0' },
  { name: 'ZREVRANK', args: 'key member [WITHSCORE]', group: 'zset', since: '2.0.0' },
  { name: 'ZPOPMIN', args: 'key [count]', group: 'zset', since: '5.0.0' },
  { name: 'ZPOPMAX', args: 'key [count]', group: 'zset', since: '5.0.0' },
  { name: 'ZRANDMEMBER', args: 'key [count [WITHSCORES]]', group: 'zset', since: '6.2.0' },
  { name: 'ZREMRANGEBYRANK', args: 'key start stop', group: 'zset', since: '2.0.0' },
  { name: 'ZREMRANGEBYSCORE', args: 'key min max', group: 'zset', since: '1.2.0' },
  { name: 'ZSCAN', args: 'key cursor [MATCH pattern] [COUNT count]', group: 'zset', since: '2.8.0' },

  // Streams
  { name: 'XADD', args: 'key [MAXLEN [~] count] *|id field value ...', group: 'stream', since: '5.0.0' },
  { name: 'XLEN', args: 'key', group: 'stream', since: '5.0.0' },
  { name: 'XRANGE', args: 'key start end [COUNT count]', group: 'stream', since: '5.0.0' },
  { name: 'XREVRANGE', args: 'key end start [COUNT count]', group: 'stream', since: '5.0.0' },
  { name: 'XDEL', args: 'key id [id ...]', group: 'stream', since: '5.0.0' },
  { name: 'XTRIM', args: 'key MAXLEN|MINID [~] threshold', group: 'stream', since: '5.0.0' },
  { name: 'XINFO', args: 'STREAM|GROUPS|CONSUMERS key', group: 'stream', since: '5.0.0' },
  { name: 'XGROUP', args: 'CREATE|DESTROY|CREATECONSUMER key group [id]', group: 'stream', since: '5.0.0' },
  { name: 'XACK', args: 'key group id [id ...]', group: 'stream', since: '5.0.0' },
  { name: 'XPENDING', args: 'key group [start end count]', group: 'stream', since: '5.0.0' },

  // Other data types
  { name: 'SETBIT', args: 'key offset value', group: 'bitmap', since: '2.2.0' },
  { name: 'GETBIT', args: 'key offset', group: 'bitmap', since: '2.2.0' },
  { name: 'BITCOUNT', args: 'key [start end [BYTE|BIT]]', group: 'bitmap', since: '2.6.0' },
  { name: 'BITPOS', args: 'key bit [start [end]]', group: 'bitmap', since: '2.8.7' },
  { name: 'PFADD', args: 'key [element ...]', group: 'hyperloglog', since: '2.8.9' },
  { name: 'PFCOUNT', args: 'key [key ...]', group: 'hyperloglog', since: '2.8.9' },
  { name: 'PFMERGE', args: 'destkey sourcekey [sourcekey ...]', group: 'hyperloglog', since: '2.8.9' },
  { name: 'GEOADD', args: 'key longitude latitude member ...', group: 'geo', since: '3.2.0' },
  { name: 'GEOPOS', args: 'key member [member ...]', group: 'geo', since: '3.2.0' },
  { name: 'GEODIST', args: 'key member1 member2 [M|KM|FT|MI]', group: 'geo', since: '3.2.0' },
  { name: 'GEOSEARCH', args: 'key FROMMEMBER|FROMLONLAT ... BYRADIUS|BYBOX ...', group: 'geo', since: '6.2.0' },

  // Pub/sub (publish only — subscribing holds the connection open)
  { name: 'PUBLISH', args: 'channel message', group: 'pubsub', since: '2.0.0' },
  { name: 'PUBSUB', args: 'CHANNELS|NUMSUB|NUMPAT [argument ...]', group: 'pubsub', since: '2.8.0' },

  // Scripting & transactions
  { name: 'EVAL', args: 'script numkeys [key ...] [arg ...]', group: 'scripting', since: '2.6.0' },
  { name: 'EVALSHA', args: 'sha1 numkeys [key ...] [arg ...]', group: 'scripting', since: '2.6.0' },
  { name: 'SCRIPT', args: 'LOAD|EXISTS|FLUSH [argument ...]', group: 'scripting', since: '2.6.0' },
  { name: 'FUNCTION', args: 'LIST|STATS|DUMP|FLUSH [argument ...]', group: 'scripting', since: '7.0.0' },

  // Server / connection
  { name: 'PING', args: '[message]', group: 'connection', since: '1.0.0' },
  { name: 'ECHO', args: 'message', group: 'connection', since: '1.0.0' },
  { name: 'SELECT', args: 'index', group: 'connection', since: '1.0.0' },
  { name: 'SWAPDB', args: 'index1 index2', group: 'server', since: '4.0.0' },
  { name: 'DBSIZE', args: '', group: 'server', since: '1.0.0' },
  { name: 'FLUSHDB', args: '[ASYNC|SYNC]', group: 'server', since: '1.0.0' },
  { name: 'FLUSHALL', args: '[ASYNC|SYNC]', group: 'server', since: '1.0.0' },
  { name: 'INFO', args: '[section]', group: 'server', since: '1.0.0' },
  { name: 'CONFIG', args: 'GET|SET|RESETSTAT parameter [value]', group: 'server', since: '2.0.0' },
  { name: 'CLIENT', args: 'LIST|INFO|KILL|NO-EVICT [argument ...]', group: 'server', since: '2.4.0' },
  { name: 'COMMAND', args: 'COUNT|DOCS|INFO [command-name ...]', group: 'server', since: '2.8.13' },
  { name: 'MEMORY', args: 'USAGE key|DOCTOR|STATS', group: 'server', since: '4.0.0' },
  { name: 'SLOWLOG', args: 'GET|LEN|RESET [count]', group: 'server', since: '2.2.12' },
  { name: 'LASTSAVE', args: '', group: 'server', since: '1.0.0' },
  { name: 'BGSAVE', args: '[SCHEDULE]', group: 'server', since: '1.0.0' },
  { name: 'BGREWRITEAOF', args: '', group: 'server', since: '1.0.0' },
  { name: 'TIME', args: '', group: 'server', since: '2.6.0' },
  { name: 'ACL', args: 'LIST|WHOAMI|CAT|GETUSER [argument ...]', group: 'server', since: '6.0.0' },
  { name: 'LATENCY', args: 'LATEST|HISTORY|DOCTOR|RESET [event]', group: 'server', since: '2.8.13' },
]

/** Every command name, uppercase — used for highlighting and lookups. */
export const REDIS_COMMAND_NAMES = new Set(REDIS_COMMANDS.map((c) => c.name))

// Commands that change the keyspace. The named ones are the catalog's writes the
// pattern can't see; the pattern catches the type-prefixed long tail
// (LPUSH, SREM, ZRANGESTORE, …), in the catalog or not.
const WRITES = new Set([
  'SET', 'SETEX', 'PSETEX', 'SETNX', 'GETSET', 'GETDEL', 'GETEX', 'APPEND', 'INCR', 'INCRBY', 'INCRBYFLOAT', 'DECR',
  'DECRBY', 'MSET', 'MSETNX', 'SETRANGE', 'SETBIT', 'DEL', 'UNLINK', 'RENAME', 'RENAMENX', 'COPY', 'RESTORE', 'MOVE',
  'MIGRATE', 'EXPIRE', 'PEXPIRE', 'EXPIREAT', 'PEXPIREAT', 'PERSIST', 'HSETNX', 'HINCRBY', 'HINCRBYFLOAT', 'ZINCRBY',
  'LPUSHX', 'RPUSHX', 'ZPOPMIN', 'ZPOPMAX', 'ZREMRANGEBYRANK', 'ZREMRANGEBYSCORE', 'ZREMRANGEBYLEX', 'XADD', 'XDEL', 'XTRIM', 'XGROUP',
  'XACK', 'XCLAIM', 'XAUTOCLAIM', 'PFADD', 'PFMERGE', 'GEOADD', 'FLUSHDB', 'FLUSHALL', 'SWAPDB',
])
const WRITE_PATTERN = /^[lrhsz]\w*(push|pop|add|set|rem|del|trim|insert|move|store)$/i

/** Is `version` (e.g. "6.0.16") at least `since` (e.g. "6.2.0")? An unknown version passes. */
export function meetsVersion(version: string | null | undefined, since: string) {
  if (!version) return true
  const a = version.split('.').map((p) => parseInt(p, 10) || 0)
  const b = since.split('.').map((p) => parseInt(p, 10) || 0)
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0)
  return true
}

/** True when a command changes the keyspace — the console refreshes the key tree after one. */
export const isWriteCommand = (name: string) => WRITES.has(String(name || '').toUpperCase()) || WRITE_PATTERN.test(name || '')

/** Display names for `group`, in the order the console's command reference lists them. */
export const REDIS_GROUP_LABELS: Record<string, string> = {
  generic: 'Keys',
  string: 'Strings',
  hash: 'Hashes',
  list: 'Lists',
  set: 'Sets',
  zset: 'Sorted sets',
  stream: 'Streams',
  bitmap: 'Bitmaps',
  hyperloglog: 'HyperLogLog',
  geo: 'Geo',
  pubsub: 'Pub/sub',
  scripting: 'Scripting & transactions',
  server: 'Server',
  connection: 'Connection',
}

const byName = new Map(REDIS_COMMANDS.map((c) => [c.name, c]))

/** Spec for a command typed in any case, or undefined if it isn't in the catalog. */
export const findCommand = (name: string) => byName.get(String(name || '').toUpperCase())

/**
 * The command the cursor is currently inside, for the console's argument hint.
 * Reads the *current line* only — one command per line, like redis-cli.
 */
export function commandAtCursor(text: string, cursor: number): RedisCommandSpec | undefined {
  const lineStart = text.lastIndexOf('\n', Math.max(cursor - 1, 0)) + 1
  const line = text.slice(lineStart, cursor)
  const first = line.trimStart().split(/\s+/)[0]
  return first ? findCommand(first) : undefined
}
