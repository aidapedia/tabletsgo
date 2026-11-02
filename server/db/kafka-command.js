/**
 * The Kafka console's command language, and the message filter it shares with
 * the topic browser.
 *
 * Pure parsing — nothing here talks to a broker. `parseCommand` turns one line
 * into a plain `{ op, … }` description that server/db/kafka.js executes, and
 * `compileFilter` turns a `WHERE` clause into a predicate over a decoded
 * message. Keeping it apart from the driver is what lets it be unit-tested
 * without a cluster.
 *
 * The grammar is deliberately small, line-based and not SQL:
 *
 *   TOPICS [LIKE 'pattern'] [INTERNAL]
 *   DESCRIBE <topic>
 *   CONFIG <topic> [SET key=value, …]
 *   CONSUME <topic> [PARTITION n] [FROM earliest|latest|-N|OFFSET n|'ISO time'] [LIMIT n] [DECODE fmt] [WHERE …]
 *   PRODUCE <topic> [PARTITION n] [KEY k] [HEADERS {…}] VALUE <rest of line>
 *   GROUPS [TOPIC <topic>]
 *   LAG <group>
 *   CLUSTER
 *   CREATE TOPIC <name> [PARTITIONS n] [REPLICATION r] [WITH key=value, …]
 *   DROP TOPIC <name> CONFIRM
 */

const badRequest = (message) => Object.assign(new Error(message), { status: 400 })

// One command per line; blank lines and `#` comments are dropped. Semicolons
// are not separators — they are legal inside a message value.
export function splitCommands(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

// ---- Scanner ---------------------------------------------------------------

// A cursor over one line. Tokens are bare words, quoted strings, balanced JSON
// blocks and comparison operators; `rest()` hands back the raw remainder for the
// clauses (WHERE, VALUE) that own the rest of the line.
class Scanner {
  constructor(text) {
    this.text = text
    this.pos = 0
  }

  skipSpace() {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) this.pos++
  }

  done() {
    this.skipSpace()
    return this.pos >= this.text.length
  }

  next() {
    this.skipSpace()
    const s = this.text
    const start = this.pos
    if (start >= s.length) return null
    const ch = s[start]

    if (ch === '"' || ch === "'") {
      let value = ''
      let i = start + 1
      for (; i < s.length; i++) {
        if (s[i] === '\\' && i + 1 < s.length) {
          value += s[++i]
        } else if (s[i] === ch && s[i + 1] === ch) {
          // A doubled quote is one literal quote — the workflow query node
          // renders {{input.x}} as a SQL-style literal for every engine.
          value += ch
          i++
        } else if (s[i] === ch) {
          break
        } else {
          value += s[i]
        }
      }
      if (i >= s.length) throw badRequest('Unterminated quote.')
      this.pos = i + 1
      return { type: 'string', value, raw: s.slice(start, this.pos) }
    }

    if (ch === '{' || ch === '[') {
      const end = balancedEnd(s, start)
      if (end < 0) throw badRequest(`Unbalanced ${ch === '{' ? 'braces' : 'brackets'}.`)
      this.pos = end + 1
      const raw = s.slice(start, this.pos)
      return { type: 'json', value: raw, raw }
    }

    const op = /^(==|!=|<>|>=|<=|=|>|<|~)/.exec(s.slice(start))
    if (op) {
      this.pos += op[0].length
      return { type: 'op', value: op[0], raw: op[0] }
    }

    if (ch === ',') {
      this.pos++
      return { type: 'comma', value: ',', raw: ',' }
    }

    const word = /^[^\s,=<>!~'"{}[\]]+/.exec(s.slice(start))
    this.pos += word[0].length
    return { type: 'word', value: word[0], raw: word[0] }
  }

  peek() {
    const save = this.pos
    const token = this.next()
    this.pos = save
    return token
  }

  // True (and consumed) when the next token is the keyword `kw`.
  keyword(kw) {
    const t = this.peek()
    if (t?.type === 'word' && t.value.toUpperCase() === kw) {
      this.next()
      return true
    }
    return false
  }

  // A value: a word or a quoted string.
  value(what) {
    const t = this.next()
    if (!t || (t.type !== 'word' && t.type !== 'string')) throw badRequest(`Expected ${what}.`)
    return t.value
  }

  integer(what) {
    const raw = this.value(what)
    if (!/^-?\d+$/.test(raw)) throw badRequest(`${what} must be a whole number, got "${raw}".`)
    return parseInt(raw, 10)
  }

  rest() {
    this.skipSpace()
    const r = this.text.slice(this.pos)
    this.pos = this.text.length
    return r
  }
}

// Index of the bracket closing the one at `start`, skipping quoted strings.
function balancedEnd(s, start) {
  let depth = 0
  let quote = null
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

// `key=value, key=value` — topic configs for CONFIG … SET and CREATE TOPIC … WITH.
function configPairs(sc) {
  const out = {}
  while (!sc.done()) {
    const name = sc.value('a config name')
    const eq = sc.next()
    if (eq?.type !== 'op' || eq.value !== '=') throw badRequest(`Expected "=" after ${name}.`)
    out[name] = String(sc.value(`a value for ${name}`))
    if (sc.peek()?.type === 'comma') sc.next()
  }
  if (!Object.keys(out).length) throw badRequest('Expected at least one key=value pair.')
  return out
}

// A FROM position: earliest | latest | -N | OFFSET n | 'ISO timestamp'.
function parseFrom(sc) {
  if (sc.keyword('OFFSET')) return `offset:${sc.integer('OFFSET')}`
  const t = sc.next()
  if (!t) throw badRequest('Expected a position after FROM.')
  if (t.type === 'string') return `ts:${t.value}`
  const v = t.value.toLowerCase()
  if (v === 'earliest' || v === 'latest' || v === 'beginning') return v === 'beginning' ? 'earliest' : v
  if (/^-\d+$/.test(v)) return v
  throw badRequest(`Unknown FROM position "${t.value}" — use earliest, latest, -N, OFFSET n or a quoted timestamp.`)
}

// ---- Commands --------------------------------------------------------------

/**
 * One command line → `{ op, … }`. Throws (status 400) with a message that says
 * what was expected, which is what the console shows.
 */
export function parseCommand(line) {
  const sc = new Scanner(String(line || '').trim())
  const head = sc.next()
  if (!head || head.type !== 'word') throw badRequest('Empty command.')
  const verb = head.value.toUpperCase()

  switch (verb) {
    case 'TOPICS': {
      const out = { op: 'topics', pattern: '', internal: false }
      while (!sc.done()) {
        if (sc.keyword('LIKE')) out.pattern = sc.value('a pattern after LIKE')
        else if (sc.keyword('INTERNAL')) out.internal = true
        else throw badRequest(`Unexpected "${sc.next().raw}" — TOPICS [LIKE 'pattern'] [INTERNAL].`)
      }
      return out
    }

    case 'DESCRIBE': {
      if (sc.keyword('GROUP')) return finish(sc, { op: 'lag', group: sc.value('a group id') })
      sc.keyword('TOPIC')
      return finish(sc, { op: 'describe', topic: sc.value('a topic name') })
    }

    case 'CONFIG': {
      const topic = sc.value('a topic name')
      if (sc.done()) return { op: 'config', topic }
      if (!sc.keyword('SET')) throw badRequest('CONFIG <topic> [SET key=value, …].')
      return { op: 'config', topic, set: configPairs(sc) }
    }

    case 'CONSUME': {
      const out = { op: 'consume', topic: sc.value('a topic name'), partition: undefined, from: 'latest', limit: undefined, decode: 'auto', where: '' }
      while (!sc.done()) {
        if (sc.keyword('PARTITION')) out.partition = sc.integer('PARTITION')
        else if (sc.keyword('FROM')) out.from = parseFrom(sc)
        else if (sc.keyword('LIMIT')) out.limit = sc.integer('LIMIT')
        else if (sc.keyword('DECODE')) out.decode = sc.value('a decoder').toLowerCase()
        else if (sc.keyword('WHERE')) {
          out.where = sc.rest()
          compileFilter(out.where) // fail at parse time, not mid-read
        } else throw badRequest(`Unexpected "${sc.next().raw}" in CONSUME.`)
      }
      return out
    }

    case 'PRODUCE': {
      const out = { op: 'produce', topic: sc.value('a topic name'), partition: undefined, key: null, headers: null, value: undefined }
      while (!sc.done()) {
        if (sc.keyword('PARTITION')) out.partition = sc.integer('PARTITION')
        else if (sc.keyword('KEY')) out.key = sc.value('a key')
        else if (sc.keyword('HEADERS')) {
          const t = sc.next()
          if (t?.type !== 'json') throw badRequest('HEADERS takes a JSON object, e.g. HEADERS {"source":"console"}.')
          out.headers = parseJsonObject(t.value, 'HEADERS')
        } else if (sc.keyword('VALUE')) {
          out.value = literalValue(sc.rest())
        } else throw badRequest(`Unexpected "${sc.next().raw}" in PRODUCE.`)
      }
      if (out.value === undefined) throw badRequest('PRODUCE needs a VALUE (use VALUE null for a tombstone).')
      return out
    }

    case 'GROUPS': {
      if (sc.done()) return { op: 'groups' }
      if (!sc.keyword('TOPIC')) throw badRequest(`Unexpected "${sc.next().raw}" — GROUPS [TOPIC <topic>].`)
      return finish(sc, { op: 'groups', topic: sc.value('a topic name') })
    }

    case 'LAG':
      return finish(sc, { op: 'lag', group: sc.value('a group id') })

    case 'CLUSTER':
      return finish(sc, { op: 'cluster' })

    case 'CREATE': {
      if (!sc.keyword('TOPIC')) throw badRequest('CREATE TOPIC <name> [PARTITIONS n] [REPLICATION r] [WITH key=value, …].')
      const out = { op: 'createTopic', name: sc.value('a topic name'), partitions: undefined, replication: undefined, configs: {} }
      while (!sc.done()) {
        if (sc.keyword('PARTITIONS')) out.partitions = sc.integer('PARTITIONS')
        else if (sc.keyword('REPLICATION')) out.replication = sc.integer('REPLICATION')
        else if (sc.keyword('WITH')) out.configs = configPairs(sc)
        else throw badRequest(`Unexpected "${sc.next().raw}" in CREATE TOPIC.`)
      }
      return out
    }

    case 'DROP': {
      if (!sc.keyword('TOPIC')) throw badRequest('DROP TOPIC <name> CONFIRM.')
      const name = sc.value('a topic name')
      if (!sc.keyword('CONFIRM')) {
        throw badRequest(`Deleting a topic loses its messages for good — write "DROP TOPIC ${name} CONFIRM" to go ahead.`)
      }
      return finish(sc, { op: 'dropTopic', name })
    }

    default:
      throw badRequest(`Unknown command "${head.value}". Try TOPICS, DESCRIBE, CONSUME, PRODUCE, GROUPS or LAG.`)
  }
}

function finish(sc, out) {
  if (!sc.done()) throw badRequest(`Unexpected "${sc.next().raw}".`)
  return out
}

function parseJsonObject(text, what) {
  try {
    const v = JSON.parse(text)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
  } catch {
    // fall through
  }
  throw badRequest(`${what} must be a JSON object.`)
}

// The VALUE clause: `null` is a tombstone, a fully quoted string is unquoted,
// anything else (JSON, plain text) is sent as written.
function literalValue(raw) {
  const text = raw.trim()
  if (!text) throw badRequest('VALUE needs something to send.')
  if (/^null$/i.test(text)) return null
  const q = text[0]
  if ((q === '"' || q === "'") && text.endsWith(q) && text.length > 1) {
    const sc = new Scanner(text)
    const t = sc.next()
    if (sc.done()) return t.value
  }
  return text
}

// ---- Filters ---------------------------------------------------------------

const OPS = new Set(['=', '==', '!=', '<>', '>', '>=', '<', '<=', '~'])

/**
 * A WHERE clause → `(message) => boolean`, where `message` is
 * `{ partition, offset, timestamp, key, value, headers, json() }` with `key`,
 * `value` and header values already decoded to strings and `json()` the parsed
 * value (or undefined when it isn't JSON).
 *
 *   key = 'ord_1' AND value.amount > 100 AND header.source ~ 'checkout'
 *
 * `~` (or CONTAINS) is a case-insensitive substring match. An empty clause
 * matches everything.
 */
export function compileFilter(text) {
  const source = String(text || '').trim()
  if (!source) return () => true
  const sc = new Scanner(source)
  const conditions = []
  do {
    const field = sc.next()
    if (!field || field.type !== 'word') throw badRequest('WHERE expects a field: key, value, value.<path>, header.<name>, partition, offset or timestamp.')
    const path = field.value.split('.')
    const root = path[0].toLowerCase()
    if (!['key', 'value', 'header', 'headers', 'partition', 'offset', 'timestamp'].includes(root)) {
      throw badRequest(`Unknown field "${field.value}" in WHERE.`)
    }
    let op = sc.next()
    if (op?.type === 'word' && op.value.toUpperCase() === 'CONTAINS') op = { type: 'op', value: '~' }
    if (op?.type !== 'op' || !OPS.has(op.value)) throw badRequest(`Expected a comparison after "${field.value}" (=, !=, >, >=, <, <=, ~).`)
    const lit = sc.next()
    if (!lit || (lit.type !== 'word' && lit.type !== 'string')) throw badRequest(`Expected a value after "${field.value} ${op.value}".`)
    conditions.push(condition(root, path.slice(1), op.value, lit))
  } while (sc.keyword('AND'))
  if (!sc.done()) throw badRequest(`Unexpected "${sc.next().raw}" in WHERE — only AND is supported between conditions.`)
  return (message) => conditions.every((c) => c(message))
}

function condition(root, path, op, lit) {
  // An unquoted literal may be a number/boolean/null; a quoted one is always text.
  const expected =
    lit.type === 'string'
      ? lit.value
      : /^-?\d+(\.\d+)?$/.test(lit.value)
        ? Number(lit.value)
        : /^(true|false)$/i.test(lit.value)
          ? lit.value.toLowerCase() === 'true'
          : /^null$/i.test(lit.value)
            ? null
            : lit.value

  const read = (m) => {
    switch (root) {
      case 'key': return m.key
      case 'partition': return m.partition
      case 'offset': return Number(m.offset)
      case 'timestamp': return Number(m.timestamp)
      case 'header':
      case 'headers': return path.length ? m.headers?.[path.join('.')] : m.headers && JSON.stringify(m.headers)
      default: {
        if (!path.length) return m.value
        let v = m.json?.()
        for (const p of path) v = v == null ? undefined : v[p]
        return v
      }
    }
  }

  // A timestamp compared with a date string means that instant.
  const target = root === 'timestamp' && typeof expected === 'string' && !Number.isNaN(Date.parse(expected)) ? Date.parse(expected) : expected

  return (m) => compare(read(m), op, target)
}

function compare(actual, op, expected) {
  if (op === '~') {
    if (actual == null || expected == null) return false
    const a = typeof actual === 'object' ? JSON.stringify(actual) : String(actual)
    return a.toLowerCase().includes(String(expected).toLowerCase())
  }
  if (expected === null) {
    const isNull = actual == null
    return op === '!=' || op === '<>' ? !isNull : op === '=' || op === '==' ? isNull : false
  }
  if (actual == null) return op === '!=' || op === '<>'

  // Numbers compare as numbers when both sides read as one; everything else as text.
  const bothNumeric = typeof expected === 'number' && actual !== '' && !Number.isNaN(Number(actual))
  const a = bothNumeric ? Number(actual) : typeof actual === 'object' ? JSON.stringify(actual) : String(actual)
  const e = bothNumeric ? expected : String(expected)
  switch (op) {
    case '=':
    case '==': return a === e
    case '!=':
    case '<>': return a !== e
    case '>': return a > e
    case '>=': return a >= e
    case '<': return a < e
    case '<=': return a <= e
    default: return false
  }
}

// `orders.*` style globs for TOPICS LIKE and the sidebar filter. Without a
// wildcard the pattern is a case-insensitive substring match.
export function topicMatcher(pattern) {
  const p = String(pattern || '').trim()
  if (!p) return () => true
  if (!/[*?]/.test(p)) return (name) => name.toLowerCase().includes(p.toLowerCase())
  const re = new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')
  return (name) => re.test(name)
}
