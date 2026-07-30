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
}

export const REDIS_COMMANDS: RedisCommandSpec[] = [
  // Keys
  { name: 'DEL', args: 'key [key ...]', group: 'generic' },
  { name: 'UNLINK', args: 'key [key ...]', group: 'generic' },
  { name: 'EXISTS', args: 'key [key ...]', group: 'generic' },
  { name: 'EXPIRE', args: 'key seconds', group: 'generic' },
  { name: 'PEXPIRE', args: 'key milliseconds', group: 'generic' },
  { name: 'EXPIREAT', args: 'key unix-time-seconds', group: 'generic' },
  { name: 'TTL', args: 'key', group: 'generic' },
  { name: 'PTTL', args: 'key', group: 'generic' },
  { name: 'PERSIST', args: 'key', group: 'generic' },
  { name: 'RENAME', args: 'key newkey', group: 'generic' },
  { name: 'RENAMENX', args: 'key newkey', group: 'generic' },
  { name: 'TYPE', args: 'key', group: 'generic' },
  { name: 'SCAN', args: 'cursor [MATCH pattern] [COUNT count] [TYPE type]', group: 'generic' },
  { name: 'KEYS', args: 'pattern', group: 'generic' },
  { name: 'RANDOMKEY', args: '', group: 'generic' },
  { name: 'TOUCH', args: 'key [key ...]', group: 'generic' },
  { name: 'COPY', args: 'source destination [DB index] [REPLACE]', group: 'generic' },
  { name: 'DUMP', args: 'key', group: 'generic' },
  { name: 'RESTORE', args: 'key ttl serialized-value [REPLACE]', group: 'generic' },
  { name: 'OBJECT', args: 'ENCODING|FREQ|IDLETIME|REFCOUNT key', group: 'generic' },
  { name: 'SORT', args: 'key [BY pattern] [LIMIT offset count] [ASC|DESC] [ALPHA]', group: 'generic' },

  // Strings
  { name: 'GET', args: 'key', group: 'string' },
  { name: 'SET', args: 'key value [EX seconds|PX ms] [NX|XX] [KEEPTTL] [GET]', group: 'string' },
  { name: 'SETNX', args: 'key value', group: 'string' },
  { name: 'SETEX', args: 'key seconds value', group: 'string' },
  { name: 'PSETEX', args: 'key milliseconds value', group: 'string' },
  { name: 'GETSET', args: 'key value', group: 'string' },
  { name: 'GETDEL', args: 'key', group: 'string' },
  { name: 'GETEX', args: 'key [EX seconds|PERSIST]', group: 'string' },
  { name: 'MGET', args: 'key [key ...]', group: 'string' },
  { name: 'MSET', args: 'key value [key value ...]', group: 'string' },
  { name: 'MSETNX', args: 'key value [key value ...]', group: 'string' },
  { name: 'APPEND', args: 'key value', group: 'string' },
  { name: 'STRLEN', args: 'key', group: 'string' },
  { name: 'INCR', args: 'key', group: 'string' },
  { name: 'DECR', args: 'key', group: 'string' },
  { name: 'INCRBY', args: 'key increment', group: 'string' },
  { name: 'DECRBY', args: 'key decrement', group: 'string' },
  { name: 'INCRBYFLOAT', args: 'key increment', group: 'string' },
  { name: 'GETRANGE', args: 'key start end', group: 'string' },
  { name: 'SETRANGE', args: 'key offset value', group: 'string' },

  // Hashes
  { name: 'HGET', args: 'key field', group: 'hash' },
  { name: 'HSET', args: 'key field value [field value ...]', group: 'hash' },
  { name: 'HSETNX', args: 'key field value', group: 'hash' },
  { name: 'HDEL', args: 'key field [field ...]', group: 'hash' },
  { name: 'HGETALL', args: 'key', group: 'hash' },
  { name: 'HKEYS', args: 'key', group: 'hash' },
  { name: 'HVALS', args: 'key', group: 'hash' },
  { name: 'HLEN', args: 'key', group: 'hash' },
  { name: 'HEXISTS', args: 'key field', group: 'hash' },
  { name: 'HMGET', args: 'key field [field ...]', group: 'hash' },
  { name: 'HINCRBY', args: 'key field increment', group: 'hash' },
  { name: 'HINCRBYFLOAT', args: 'key field increment', group: 'hash' },
  { name: 'HRANDFIELD', args: 'key [count [WITHVALUES]]', group: 'hash' },
  { name: 'HSCAN', args: 'key cursor [MATCH pattern] [COUNT count]', group: 'hash' },

  // Lists
  { name: 'LPUSH', args: 'key element [element ...]', group: 'list' },
  { name: 'RPUSH', args: 'key element [element ...]', group: 'list' },
  { name: 'LPUSHX', args: 'key element [element ...]', group: 'list' },
  { name: 'RPUSHX', args: 'key element [element ...]', group: 'list' },
  { name: 'LPOP', args: 'key [count]', group: 'list' },
  { name: 'RPOP', args: 'key [count]', group: 'list' },
  { name: 'LRANGE', args: 'key start stop', group: 'list' },
  { name: 'LLEN', args: 'key', group: 'list' },
  { name: 'LINDEX', args: 'key index', group: 'list' },
  { name: 'LSET', args: 'key index element', group: 'list' },
  { name: 'LINSERT', args: 'key BEFORE|AFTER pivot element', group: 'list' },
  { name: 'LREM', args: 'key count element', group: 'list' },
  { name: 'LTRIM', args: 'key start stop', group: 'list' },
  { name: 'LMOVE', args: 'source destination LEFT|RIGHT LEFT|RIGHT', group: 'list' },
  { name: 'LPOS', args: 'key element [RANK rank] [COUNT count]', group: 'list' },

  // Sets
  { name: 'SADD', args: 'key member [member ...]', group: 'set' },
  { name: 'SREM', args: 'key member [member ...]', group: 'set' },
  { name: 'SMEMBERS', args: 'key', group: 'set' },
  { name: 'SISMEMBER', args: 'key member', group: 'set' },
  { name: 'SMISMEMBER', args: 'key member [member ...]', group: 'set' },
  { name: 'SCARD', args: 'key', group: 'set' },
  { name: 'SPOP', args: 'key [count]', group: 'set' },
  { name: 'SRANDMEMBER', args: 'key [count]', group: 'set' },
  { name: 'SMOVE', args: 'source destination member', group: 'set' },
  { name: 'SDIFF', args: 'key [key ...]', group: 'set' },
  { name: 'SINTER', args: 'key [key ...]', group: 'set' },
  { name: 'SUNION', args: 'key [key ...]', group: 'set' },
  { name: 'SDIFFSTORE', args: 'destination key [key ...]', group: 'set' },
  { name: 'SINTERSTORE', args: 'destination key [key ...]', group: 'set' },
  { name: 'SUNIONSTORE', args: 'destination key [key ...]', group: 'set' },
  { name: 'SSCAN', args: 'key cursor [MATCH pattern] [COUNT count]', group: 'set' },

  // Sorted sets
  { name: 'ZADD', args: 'key [NX|XX] [GT|LT] [CH] [INCR] score member ...', group: 'zset' },
  { name: 'ZREM', args: 'key member [member ...]', group: 'zset' },
  { name: 'ZSCORE', args: 'key member', group: 'zset' },
  { name: 'ZMSCORE', args: 'key member [member ...]', group: 'zset' },
  { name: 'ZCARD', args: 'key', group: 'zset' },
  { name: 'ZCOUNT', args: 'key min max', group: 'zset' },
  { name: 'ZINCRBY', args: 'key increment member', group: 'zset' },
  { name: 'ZRANGE', args: 'key start stop [BYSCORE|BYLEX] [REV] [LIMIT offset count] [WITHSCORES]', group: 'zset' },
  { name: 'ZREVRANGE', args: 'key start stop [WITHSCORES]', group: 'zset' },
  { name: 'ZRANGEBYSCORE', args: 'key min max [WITHSCORES] [LIMIT offset count]', group: 'zset' },
  { name: 'ZRANK', args: 'key member [WITHSCORE]', group: 'zset' },
  { name: 'ZREVRANK', args: 'key member [WITHSCORE]', group: 'zset' },
  { name: 'ZPOPMIN', args: 'key [count]', group: 'zset' },
  { name: 'ZPOPMAX', args: 'key [count]', group: 'zset' },
  { name: 'ZRANDMEMBER', args: 'key [count [WITHSCORES]]', group: 'zset' },
  { name: 'ZREMRANGEBYRANK', args: 'key start stop', group: 'zset' },
  { name: 'ZREMRANGEBYSCORE', args: 'key min max', group: 'zset' },
  { name: 'ZSCAN', args: 'key cursor [MATCH pattern] [COUNT count]', group: 'zset' },

  // Streams
  { name: 'XADD', args: 'key [MAXLEN [~] count] *|id field value ...', group: 'stream' },
  { name: 'XLEN', args: 'key', group: 'stream' },
  { name: 'XRANGE', args: 'key start end [COUNT count]', group: 'stream' },
  { name: 'XREVRANGE', args: 'key end start [COUNT count]', group: 'stream' },
  { name: 'XDEL', args: 'key id [id ...]', group: 'stream' },
  { name: 'XTRIM', args: 'key MAXLEN|MINID [~] threshold', group: 'stream' },
  { name: 'XINFO', args: 'STREAM|GROUPS|CONSUMERS key', group: 'stream' },
  { name: 'XGROUP', args: 'CREATE|DESTROY|CREATECONSUMER key group [id]', group: 'stream' },
  { name: 'XACK', args: 'key group id [id ...]', group: 'stream' },
  { name: 'XPENDING', args: 'key group [start end count]', group: 'stream' },

  // Other data types
  { name: 'SETBIT', args: 'key offset value', group: 'bitmap' },
  { name: 'GETBIT', args: 'key offset', group: 'bitmap' },
  { name: 'BITCOUNT', args: 'key [start end [BYTE|BIT]]', group: 'bitmap' },
  { name: 'BITPOS', args: 'key bit [start [end]]', group: 'bitmap' },
  { name: 'PFADD', args: 'key [element ...]', group: 'hyperloglog' },
  { name: 'PFCOUNT', args: 'key [key ...]', group: 'hyperloglog' },
  { name: 'PFMERGE', args: 'destkey sourcekey [sourcekey ...]', group: 'hyperloglog' },
  { name: 'GEOADD', args: 'key longitude latitude member ...', group: 'geo' },
  { name: 'GEOPOS', args: 'key member [member ...]', group: 'geo' },
  { name: 'GEODIST', args: 'key member1 member2 [M|KM|FT|MI]', group: 'geo' },
  { name: 'GEOSEARCH', args: 'key FROMMEMBER|FROMLONLAT ... BYRADIUS|BYBOX ...', group: 'geo' },

  // Pub/sub (publish only — subscribing holds the connection open)
  { name: 'PUBLISH', args: 'channel message', group: 'pubsub' },
  { name: 'PUBSUB', args: 'CHANNELS|NUMSUB|NUMPAT [argument ...]', group: 'pubsub' },

  // Scripting & transactions
  { name: 'EVAL', args: 'script numkeys [key ...] [arg ...]', group: 'scripting' },
  { name: 'EVALSHA', args: 'sha1 numkeys [key ...] [arg ...]', group: 'scripting' },
  { name: 'SCRIPT', args: 'LOAD|EXISTS|FLUSH [argument ...]', group: 'scripting' },
  { name: 'FUNCTION', args: 'LIST|STATS|DUMP|FLUSH [argument ...]', group: 'scripting' },

  // Server / connection
  { name: 'PING', args: '[message]', group: 'connection' },
  { name: 'ECHO', args: 'message', group: 'connection' },
  { name: 'SELECT', args: 'index', group: 'connection' },
  { name: 'SWAPDB', args: 'index1 index2', group: 'server' },
  { name: 'DBSIZE', args: '', group: 'server' },
  { name: 'FLUSHDB', args: '[ASYNC|SYNC]', group: 'server' },
  { name: 'FLUSHALL', args: '[ASYNC|SYNC]', group: 'server' },
  { name: 'INFO', args: '[section]', group: 'server' },
  { name: 'CONFIG', args: 'GET|SET|RESETSTAT parameter [value]', group: 'server' },
  { name: 'CLIENT', args: 'LIST|INFO|KILL|NO-EVICT [argument ...]', group: 'server' },
  { name: 'COMMAND', args: 'COUNT|DOCS|INFO [command-name ...]', group: 'server' },
  { name: 'MEMORY', args: 'USAGE key|DOCTOR|STATS', group: 'server' },
  { name: 'SLOWLOG', args: 'GET|LEN|RESET [count]', group: 'server' },
  { name: 'LASTSAVE', args: '', group: 'server' },
  { name: 'BGSAVE', args: '[SCHEDULE]', group: 'server' },
  { name: 'BGREWRITEAOF', args: '', group: 'server' },
  { name: 'TIME', args: '', group: 'server' },
  { name: 'ACL', args: 'LIST|WHOAMI|CAT|GETUSER [argument ...]', group: 'server' },
  { name: 'LATENCY', args: 'LATEST|HISTORY|DOCTOR|RESET [event]', group: 'server' },
]

/** Every command name, uppercase — used for highlighting and lookups. */
export const REDIS_COMMAND_NAMES = new Set(REDIS_COMMANDS.map((c) => c.name))

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
