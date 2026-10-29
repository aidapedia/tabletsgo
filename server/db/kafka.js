/**
 * Kafka driver — topics, bounded message reads, producing and consumer groups.
 *
 * Kafka is the second engine with no tables (after Redis) and follows the same
 * rule: adapt at the edges, never fork the contract. The console's commands ride
 * the generic `runQuery` (see ./kafka-command.js for the grammar) and answer in
 * the shape every engine uses (`{ type: 'rows', columns, rows }` |
 * `{ type: 'message', message }` | `{ error }`), which is why saved queries, the
 * workflow query node and dashboard widgets work against a cluster unchanged.
 *
 * Everything else is the *stream* capability — optional ops in the contract
 * (server/db/index.js) named for what they do, not for Kafka, so another
 * log-shaped engine (Redis Streams, Pulsar…) can implement the same set and
 * reuse the /streams/* routes and the console UI as they are.
 *
 * Reads never disturb anyone's consumers. A read is a handful of Fetch requests
 * sent straight to each partition's leader from explicit offsets: no group is
 * joined, nothing is committed, so browsing never shows up as a consumer group
 * or as lag. kafkajs's public Consumer can only read by joining a group, so the
 * fetch path uses its internal Cluster/Broker — the same machinery its own
 * Consumer drives — which is why `kafkajs` is pinned to an exact version.
 *
 * Every read is bounded by KAFKA_READ_MAX_MESSAGES / _BYTES / _TIMEOUT_MS: there
 * is no long-lived consumer behind a request, the same reason the Redis driver
 * refuses SUBSCRIBE.
 */

import { createRequire } from 'module'
import net from 'net'
import tls from 'tls'
import { randomUUID } from 'crypto'
import kafkajs from 'kafkajs'
import { KAFKA_READ_MAX_BYTES, KAFKA_READ_MAX_MESSAGES, KAFKA_READ_TIMEOUT_MS } from '../config.js'
import { classifyTransport } from './diagnose.js'
import { compileFilter, parseCommand, splitCommands, topicMatcher } from './kafka-command.js'

const { Kafka, logLevel, ConfigResourceTypes, Partitioners, AssignerProtocol } = kafkajs
const require = createRequire(import.meta.url)
const Cluster = require('kafkajs/src/cluster')
const { createLogger } = require('kafkajs/src/loggers')
const defaultSocketFactory = require('kafkajs/src/network/socketFactory')

const DEFAULT_PORT = 9092
// Values longer than this are cut in the grid; the cell says so.
const PREVIEW_CHARS = 64 * 1024
const MESSAGE_COLUMNS = ['partition', 'offset', 'timestamp', 'key', 'value', 'headers', 'size']

const silent = () => () => {}

// ---- Connection config -----------------------------------------------------

// The bootstrap list. `brokers` is the comma-separated list the form stores;
// `host`/`port` (the first broker) is the fallback, and what the SSH tunnel and
// the handshake's "target" read.
export function brokersOf(conn) {
  const list = String(conn.brokers || '')
    .split(/[\s,]+/)
    .map((b) => b.trim().replace(/^[a-z+]+:\/\//i, ''))
    .filter(Boolean)
    .map((b) => (/:\d+$/.test(b) ? b : `${b}:${DEFAULT_PORT}`))
  if (list.length) return list
  return conn.host ? [`${conn.host}:${parseInt(conn.port) || DEFAULT_PORT}`] : []
}

// `tls` is the same '' | 'require' | 'insecure' switch Redis uses.
function sslOf(conn) {
  if (!conn.tls) return undefined
  return { rejectUnauthorized: conn.tls !== 'insecure', ...(conn.caCert?.trim() ? { ca: [conn.caCert] } : {}) }
}

// PLAIN and SCRAM authenticate with the connection's username/password.
const SASL_MECHANISMS = new Set(['plain', 'scram-sha-256', 'scram-sha-512'])
function saslOf(conn) {
  const mechanism = String(conn.saslMechanism || '').toLowerCase()
  if (!mechanism || conn.auth === 'none') return undefined
  if (!SASL_MECHANISMS.has(mechanism)) {
    throw Object.assign(new Error(`SASL mechanism "${conn.saslMechanism}" is not supported — use PLAIN, SCRAM-SHA-256 or SCRAM-SHA-512.`), { status: 400 })
  }
  return { mechanism, username: conn.username || '', password: conn.password || '' }
}

/**
 * How sockets are opened. Direct: kafkajs's own factory. Through an SSH tunnel
 * (./tunnel.js hands us `forwardPort`): a Kafka client is redirected to every
 * broker the cluster *advertises*, not just the bootstrap address, so each
 * advertised host:port gets its own local listener on the same SSH session.
 * The socket is returned at once and connected when the port is known; TLS
 * wraps it and still verifies the broker's real name.
 */
function socketFactoryFor(conn) {
  if (typeof conn.forwardPort !== 'function') return defaultSocketFactory()
  return ({ host, port, ssl, onConnect }) => {
    const raw = new net.Socket()
    const socket = ssl ? tls.connect({ ...ssl, socket: raw, ...(net.isIP(host) ? {} : { servername: host }) }, onConnect) : raw
    if (!ssl) raw.once('connect', onConnect)
    if (socket !== raw) raw.on('error', (error) => socket.destroy(error))
    conn
      .forwardPort(host, Number(port))
      .then((local) => raw.connect(local, '127.0.0.1'))
      .catch((error) => raw.destroy(error))
    raw.setKeepAlive(true, 60000)
    return socket
  }
}

function clientOptions(conn) {
  return {
    clientId: conn.clientId?.trim() || 'tabletsgo',
    brokers: brokersOf(conn),
    ssl: sslOf(conn),
    sasl: saslOf(conn),
    connectionTimeout: 5000,
    authenticationTimeout: 10000,
    requestTimeout: 30000,
    retry: { retries: 1, initialRetryTime: 200, maxRetryTime: 2000 },
    socketFactory: socketFactoryFor(conn),
  }
}

// ---- Client pool -------------------------------------------------------------

// One entry per connection: an admin client (metadata, offsets, groups,
// configs), a producer and a fetch-only cluster, each connected on first use.
const pool = new Map()

function entryFor(conn) {
  let entry = pool.get(conn.id)
  if (!entry) {
    const options = clientOptions(conn)
    if (!options.brokers.length) throw Object.assign(new Error('This connection has no bootstrap brokers.'), { status: 400 })
    const kafka = new Kafka({ ...options, logLevel: logLevel.NOTHING, logCreator: silent })
    entry = { options, kafka, admin: kafka.admin(), adminReady: null, producer: null, producerReady: null, cluster: null, clusterReady: null }
    pool.set(conn.id, entry)
  }
  return entry
}

// Connect once; a failed connect is forgotten so the next call tries again.
const once = (entry, key, connect) => {
  if (!entry[key]) entry[key] = connect().catch((error) => {
    entry[key] = null
    throw error
  })
  return entry[key]
}

async function adminFor(conn) {
  const entry = entryFor(conn)
  await once(entry, 'adminReady', () => entry.admin.connect())
  return entry.admin
}

async function producerFor(conn) {
  const entry = entryFor(conn)
  entry.producer ||= entry.kafka.producer({ allowAutoTopicCreation: false, createPartitioner: Partitioners.DefaultPartitioner })
  await once(entry, 'producerReady', () => entry.producer.connect())
  return entry.producer
}

async function clusterFor(conn) {
  const entry = entryFor(conn)
  entry.cluster ||= new Cluster({
    ...entry.options,
    logger: createLogger({ level: logLevel.NOTHING, logCreator: silent }),
    allowAutoTopicCreation: false,
    metadataMaxAge: 60000,
  })
  await once(entry, 'clusterReady', () => entry.cluster.connect())
  return entry.cluster
}

export function closeKafkaClients(id) {
  const entry = pool.get(id)
  if (!entry) return
  pool.delete(id)
  const quiet = (p) => Promise.resolve(p).catch(() => {})
  quiet(entry.adminReady && entry.admin.disconnect())
  quiet(entry.producerReady && entry.producer.disconnect())
  quiet(entry.clusterReady && entry.cluster.disconnect())
}

export function closeAllKafkaClients() {
  for (const id of [...pool.keys()]) closeKafkaClients(id)
}

// ---- Errors --------------------------------------------------------------------

// kafkajs nests the real failure: a retries-exceeded error wraps a non-retriable
// one which wraps the connection error that carries the socket code.
function rootCause(error) {
  let e = error
  for (let i = 0; i < 5 && e?.cause; i++) e = e.cause
  return e || error
}

const STATUS_BY_TYPE = {
  UNKNOWN_TOPIC_OR_PARTITION: 404,
  GROUP_ID_NOT_FOUND: 404,
  TOPIC_ALREADY_EXISTS: 409,
  NON_EMPTY_GROUP: 409,
  INVALID_PARTITIONS: 400,
  INVALID_REPLICATION_FACTOR: 400,
  INVALID_TOPIC_EXCEPTION: 400,
  INVALID_CONFIG: 400,
  POLICY_VIOLATION: 400,
  TOPIC_AUTHORIZATION_FAILED: 403,
  GROUP_AUTHORIZATION_FAILED: 403,
  CLUSTER_AUTHORIZATION_FAILED: 403,
}

// Give a broker error a status a route can answer with, and a message that
// names the thing it is about.
function routeError(error, subject) {
  const cause = rootCause(error)
  const type = error?.type || cause?.type
  if (error?.status) return error
  const status = STATUS_BY_TYPE[type]
  if (!status) return error
  const message =
    type === 'UNKNOWN_TOPIC_OR_PARTITION' && subject ? `Topic "${subject}" does not exist.` :
    type === 'TOPIC_ALREADY_EXISTS' && subject ? `Topic "${subject}" already exists.` :
    type === 'GROUP_ID_NOT_FOUND' && subject ? `Consumer group "${subject}" does not exist.` :
    cause?.message || error.message
  return Object.assign(new Error(message), { status, type })
}

const isUnknownTopic = (error) => error?.type === 'UNKNOWN_TOPIC_OR_PARTITION' || rootCause(error)?.type === 'UNKNOWN_TOPIC_OR_PARTITION'

/**
 * Run `fn(admin)` and give its failure a status. kafkajs clients remember every
 * topic they have touched and refresh metadata for all of them, so one that no
 * longer exists — deleted elsewhere, or a name looked up that never existed —
 * makes every later refresh on that client fail. On that error the
 * connection's clients are dropped and the call is tried once more with fresh
 * ones; only a topic that really is missing reaches the caller.
 */
async function withAdmin(conn, subject, fn) {
  try {
    return await fn(await adminFor(conn))
  } catch (error) {
    if (!isUnknownTopic(error)) throw routeError(error, subject)
    closeKafkaClients(conn.id)
    try {
      return await fn(await adminFor(conn))
    } catch (retryError) {
      throw routeError(retryError, subject)
    }
  }
}

// ---- Decoding ------------------------------------------------------------------

const DECODERS = new Set(['auto', 'json', 'string', 'hex', 'base64'])

// Bytes → what the grid shows. `auto` reads UTF-8 text and falls back to hex for
// binary; a Confluent Schema Registry payload (magic byte 0 + schema id) is
// labelled so it isn't mistaken for garbage.
function decodeBytes(buf, decode = 'auto') {
  if (buf == null) return null
  if (decode === 'hex') return buf.toString('hex')
  if (decode === 'base64') return buf.toString('base64')
  if (decode === 'auto' && buf.length > 5 && buf[0] === 0) {
    return `[schema ${buf.readInt32BE(1)}] ${buf.subarray(5).toString('hex')}`
  }
  const text = buf.toString('utf8')
  if (decode === 'auto' && (text.includes('�') || /[\x00-\x08\x0E-\x1F]/.test(text))) return buf.toString('hex')
  return text
}

const clip = (text) => (text != null && text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}… (truncated)` : text)

function decodeHeaders(headers) {
  const entries = Object.entries(headers || {})
  if (!entries.length) return null
  const out = {}
  for (const [k, v] of entries) out[k] = Array.isArray(v) ? v.map((x) => decodeBytes(x, 'string')) : decodeBytes(v, 'string')
  return out
}

// ---- Overview / topics -----------------------------------------------------------

const isInternal = (name) => name.startsWith('__') || name === '_schemas' || name.startsWith('_confluent')

async function overview(conn) {
  const [cluster, topics] = await withAdmin(conn, null, (admin) => Promise.all([admin.describeCluster(), admin.listTopics()]))
  return {
    clusterId: cluster.clusterId,
    controller: cluster.controller,
    brokers: cluster.brokers.map((b) => ({ nodeId: b.nodeId, host: b.host, port: b.port })),
    topicCount: topics.filter((t) => !isInternal(t)).length,
    internalTopicCount: topics.filter(isInternal).length,
  }
}

function partitionSummary(partitions) {
  return {
    partitions: partitions.length,
    replication: partitions[0]?.replicas?.length || 0,
    underReplicated: partitions.filter((p) => (p.isr?.length || 0) < (p.replicas?.length || 0)).length,
  }
}

async function listTopics(conn, { pattern = '', internal = false } = {}) {
  const match = topicMatcher(pattern)
  const topics = await withAdmin(conn, null, async (admin) => {
    const names = (await admin.listTopics()).filter((n) => (internal || !isInternal(n)) && match(n))
    return names.length ? (await admin.fetchTopicMetadata({ topics: names })).topics : []
  })
  return topics
    .map((t) => ({ name: t.name, internal: isInternal(t.name), ...partitionSummary(t.partitions) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function describeTopic(conn, topic) {
  return withAdmin(conn, topic, async (admin) => {
    const [{ topics }, offsets, configs] = await Promise.all([
      admin.fetchTopicMetadata({ topics: [topic] }),
      admin.fetchTopicOffsets(topic),
      admin.describeConfigs({ includeSynonyms: false, resources: [{ type: ConfigResourceTypes.TOPIC, name: topic }] }),
    ])
    const meta = topics[0]
    const byPartition = new Map(offsets.map((o) => [o.partition, o]))
    const partitions = meta.partitions
      .map((p) => {
        const o = byPartition.get(p.partitionId) || {}
        const low = Number(o.low || 0)
        const high = Number(o.high || 0)
        return {
          partition: p.partitionId,
          leader: p.leader,
          replicas: p.replicas,
          isr: p.isr,
          offline: p.offlineReplicas || [],
          low,
          high,
          messages: Math.max(high - low, 0),
        }
      })
      .sort((a, b) => a.partition - b.partition)
    return {
      name: topic,
      internal: isInternal(topic),
      ...partitionSummary(meta.partitions),
      messages: partitions.reduce((n, p) => n + p.messages, 0),
      partitionList: partitions,
      configs: (configs.resources[0]?.configEntries || [])
        .map((c) => ({
          name: c.configName,
          value: c.isSensitive ? null : c.configValue,
          isDefault: c.isDefault,
          readOnly: c.readOnly,
          sensitive: c.isSensitive,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  })
}

const TOPIC_NAME = /^[a-zA-Z0-9._-]{1,249}$/

async function createTopic(conn, { name, partitions, replication, configs = {}, validateOnly = false }) {
  if (!TOPIC_NAME.test(name || '') || name === '.' || name === '..') {
    throw Object.assign(new Error('A topic name uses letters, digits, ".", "_" and "-" only, up to 249 characters.'), { status: 400 })
  }
  const created = await withAdmin(conn, name, (admin) =>
    admin.createTopics({
      validateOnly,
      waitForLeaders: !validateOnly,
      topics: [
        {
          topic: name,
          numPartitions: partitions ? Number(partitions) : -1,
          replicationFactor: replication ? Number(replication) : -1,
          configEntries: Object.entries(configs).map(([k, v]) => ({ name: k, value: String(v) })),
        },
      ],
    })
  )
  if (!created && !validateOnly) throw Object.assign(new Error(`Topic "${name}" already exists.`), { status: 409 })
  return { ok: true, name, validateOnly }
}

/**
 * Change a topic's configs and/or grow its partitions. Kafka's AlterConfigs
 * *replaces* a topic's whole dynamic config, so the current overrides are read
 * first and the change is merged into them — setting one key must not quietly
 * reset the others. A value of null removes an override.
 */
async function alterTopic(conn, topic, { configs, partitions } = {}) {
  return withAdmin(conn, topic, async (admin) => {
    if (configs && Object.keys(configs).length) {
      const current = await admin.describeConfigs({ includeSynonyms: false, resources: [{ type: ConfigResourceTypes.TOPIC, name: topic }] })
      const merged = {}
      for (const c of current.resources[0]?.configEntries || []) {
        // configSource 1 = DYNAMIC_TOPIC_CONFIG: an override set on this topic.
        if (!c.isDefault && !c.readOnly && c.configSource === 1 && !c.isSensitive) merged[c.configName] = c.configValue
      }
      for (const [k, v] of Object.entries(configs)) {
        if (v === null || v === undefined || v === '') delete merged[k]
        else merged[k] = String(v)
      }
      await admin.alterConfigs({
        validateOnly: false,
        resources: [{ type: ConfigResourceTypes.TOPIC, name: topic, configEntries: Object.entries(merged).map(([name, value]) => ({ name, value })) }],
      })
    }
    if (partitions != null) {
      await admin.createPartitions({ topicPartitions: [{ topic, count: Number(partitions) }] })
    }
    return { ok: true }
  })
}

async function deleteTopic(conn, topic) {
  await withAdmin(conn, topic, (admin) => admin.deleteTopics({ topics: [topic] }))
  return { ok: true }
}

// ---- Reading messages --------------------------------------------------------

const clampLimit = (limit) => Math.min(Math.max(parseInt(limit) || 100, 1), KAFKA_READ_MAX_MESSAGES)

/**
 * Where each partition's read starts and stops, for a `from` position:
 *   latest | -N      the newest N per partition (N = the limit for `latest`)
 *   earliest          from the start of the log
 *   offset:N          from offset N (clamped into the retained range)
 *   ts:<ISO|ms>       from the first message at or after that time
 * With a filter, the newest-first window widens to whatever the byte budget
 * lets it scan, so a WHERE clause looks further back than the row limit.
 */
async function readPlan(admin, topic, partitions, from, limit, filtered) {
  const position = String(from || 'latest').toLowerCase()
  const newest = position === 'latest' || /^-\d+$/.test(position)
  let starts
  if (position.startsWith('ts:')) {
    const raw = from.slice(3)
    const ms = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw)
    if (Number.isNaN(ms)) throw Object.assign(new Error(`"${raw}" is not a timestamp.`), { status: 400 })
    const byTime = await admin.fetchTopicOffsetsByTimestamp(topic, ms)
    starts = new Map(byTime.map((o) => [o.partition, Number(o.offset)]))
  }
  const back = /^-\d+$/.test(position) ? Math.abs(parseInt(position, 10)) : limit
  const window = filtered ? Math.max(back, 100000) : back

  return {
    newest,
    ranges: partitions.map((p) => {
      const low = Number(p.low)
      const high = Number(p.high)
      let start = low
      if (newest) start = Math.max(low, high - window)
      else if (position.startsWith('offset:')) start = Math.min(Math.max(parseInt(position.slice(7), 10) || 0, low), high)
      else if (starts) start = starts.get(p.partition) >= 0 ? Math.max(starts.get(p.partition), low) : high
      // `-N` reads exactly the last N; the others read forward to the end.
      return { partition: p.partition, start, end: high, low, high }
    }),
  }
}

/**
 * A bounded read of one topic. Returns the grid shape plus what the browser
 * needs to explain the result: how much was scanned, whether a cap cut it short,
 * and a per-partition cursor to read older messages from.
 */
async function readMessages(conn, { topic, partition, from = 'latest', limit, filter = '', decode = 'auto' } = {}) {
  if (!topic) throw Object.assign(new Error('A topic is required.'), { status: 400 })
  const format = DECODERS.has(String(decode).toLowerCase()) ? String(decode).toLowerCase() : 'auto'
  const take = clampLimit(limit)
  const predicate = compileFilter(filter)
  const filtered = Boolean(String(filter || '').trim())
  const started = Date.now()
  const deadline = started + KAFKA_READ_TIMEOUT_MS

  return withAdmin(conn, topic, async (admin) => {
    const offsets = await admin.fetchTopicOffsets(topic)
    const wanted = partition === undefined || partition === null || partition === '' ? null : Number(partition)
    const parts = wanted === null ? offsets : offsets.filter((o) => o.partition === wanted)
    if (!parts.length) throw Object.assign(new Error(`Topic "${topic}" has no partition ${wanted}.`), { status: 404 })

    const { newest, ranges } = await readPlan(admin, topic, parts, from, take, filtered)
    const cluster = await clusterFor(conn)
    await cluster.addTargetTopic(topic)

    let bytes = 0
    let scanned = 0
    let cappedBy = null
    const matched = []

    // Fetch [from, to) of one partition from its leader, reading forward. Stops
    // early at a cap, or once `enough` matches have been collected. Returns how
    // many matched.
    const readRange = async (partitionId, from, to, enough) => {
      let offset = from
      let collected = 0
      let retried = false
      while (offset < to) {
        if (Date.now() > deadline) { cappedBy = 'time'; return collected }
        if (bytes >= KAFKA_READ_MAX_BYTES) { cappedBy = 'bytes'; return collected }
        if (collected >= enough) return collected
        const range = { partition: partitionId, end: to }

        let response
        try {
          const leader = cluster.findTopicPartitionMetadata(topic).find((m) => m.partitionId === range.partition)?.leader
          const broker = await cluster.findBroker({ nodeId: String(leader) })
          response = await broker.fetch({
            replicaId: -1,
            isolationLevel: 0,
            maxWaitTime: 50,
            minBytes: 1,
            maxBytes: Math.min(4 * 1024 * 1024, KAFKA_READ_MAX_BYTES),
            topics: [{ topic, partitions: [{ partition: range.partition, fetchOffset: String(offset), maxBytes: 1024 * 1024 }] }],
          })
        } catch (error) {
          // A leader moved since the metadata was read: refresh once and retry.
          if (!retried && /LEADER|NOT_LEADER|BrokerNotFound|UNKNOWN_TOPIC/i.test(`${error.type} ${error.name}`)) {
            retried = true
            await cluster.refreshMetadata()
            continue
          }
          throw error
        }

        const messages = response.responses[0]?.partitions[0]?.messages || []
        let advanced = false
        for (const m of messages) {
          const at = Number(m.offset)
          if (at < offset || at >= range.end) continue
          offset = at + 1
          advanced = true
          if (m.isControlRecord) continue
          const size = (m.key?.length || 0) + (m.value?.length || 0)
          bytes += size
          scanned += 1
          const key = decodeBytes(m.key, 'string')
          const value = decodeBytes(m.value, format)
          const headers = decodeHeaders(m.headers)
          let parsed
          const row = {
            partition: range.partition,
            offset: at,
            timestamp: Number(m.timestamp),
            key,
            value,
            headers,
            size,
            json: () => {
              if (parsed === undefined) {
                try { parsed = value == null ? null : JSON.parse(value) } catch { parsed = null }
              }
              return parsed
            },
          }
          if (predicate(row)) {
            matched.push(row)
            collected += 1
          }
        }
        // Nothing new came back (an empty or compacted range): stop rather than spin.
        if (!advanced) return collected
      }
      return collected
    }

    // Oldest-first positions read forward from their start. Newest-first reads
    // walk back from the end in chunks, so a filtered read finds the *recent*
    // matches before the byte budget runs out on old ones.
    const readPartition = async (range) => {
      if (!newest) return readRange(range.partition, range.start, range.end, take)
      const chunk = filtered ? Math.max(take, 500) : range.end - range.start
      let hi = range.end
      let found = 0
      while (hi > range.start && found < take && !cappedBy) {
        const lo = Math.max(range.start, hi - chunk)
        found += await readRange(range.partition, lo, hi, Infinity)
        hi = lo
      }
    }

    await Promise.all(ranges.filter((r) => r.start < r.end).map(readPartition))

    matched.sort((a, b) => (newest ? b.timestamp - a.timestamp || b.offset - a.offset : a.timestamp - b.timestamp || a.offset - b.offset))
    const page = matched.slice(0, take)

    // Older messages start below the oldest row this page shows, per partition.
    const cursor = {}
    for (const r of ranges) {
      const shown = page.filter((m) => m.partition === r.partition)
      const oldest = shown.length ? Math.min(...shown.map((m) => m.offset)) : r.start
      if (oldest > r.low) cursor[r.partition] = oldest
    }

    return {
      type: 'rows',
      columns: MESSAGE_COLUMNS,
      rows: page.map((m) => ({
        partition: m.partition,
        offset: m.offset,
        timestamp: new Date(m.timestamp).toISOString(),
        key: m.key,
        value: clip(m.value),
        headers: m.headers ? JSON.stringify(m.headers) : null,
        size: m.size,
      })),
      scanned,
      matched: matched.length,
      truncated: Boolean(cappedBy) || matched.length > take,
      cappedBy,
      cursor,
      elapsedMs: Date.now() - started,
    }
  })
}

// ---- Producing ---------------------------------------------------------------

async function produce(conn, { topic, partition, key = null, value, headers = null } = {}) {
  if (!topic) throw Object.assign(new Error('A topic is required.'), { status: 400 })
  if (value === undefined) throw Object.assign(new Error('A value is required (null sends a tombstone).'), { status: 400 })
  const message = {
    key: key === null || key === undefined || key === '' ? null : String(key),
    value: value === null ? null : typeof value === 'string' ? value : JSON.stringify(value),
    headers: headers ? Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, String(v)])) : undefined,
    ...(partition === undefined || partition === null || partition === '' ? {} : { partition: Number(partition) }),
  }
  const [result] = await withAdmin(conn, topic, async () => (await producerFor(conn)).send({ topic, acks: -1, messages: [message] }))
  return { topic, partition: result.partition, offset: Number(result.baseOffset), timestamp: result.logAppendTime && result.logAppendTime !== '-1' ? Number(result.logAppendTime) : Date.now() }
}

// ---- Consumer groups ---------------------------------------------------------

// End offsets for a set of topics, fetched once each.
async function endOffsets(admin, topics) {
  const out = new Map()
  await Promise.all(
    [...new Set(topics)].map(async (t) => {
      try {
        out.set(t, new Map((await admin.fetchTopicOffsets(t)).map((o) => [o.partition, { low: Number(o.low), high: Number(o.high) }])))
      } catch {
        out.set(t, new Map()) // a deleted topic still listed in old commits
      }
    })
  )
  return out
}

// Run `fn` over `items`, at most `limit` at a time.
async function mapLimited(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

function assignmentOf(member) {
  try {
    return AssignerProtocol.MemberAssignment.decode(member.memberAssignment)?.assignment || {}
  } catch {
    return {}
  }
}

async function listGroups(conn) {
  return withAdmin(conn, null, (admin) => groupsOverview(admin))
}

async function groupsOverview(admin) {
  const { groups } = await admin.listGroups()
  const ids = groups.filter((g) => !g.protocolType || g.protocolType === 'consumer').map((g) => g.groupId)
  if (!ids.length) return []
  const { groups: described } = await admin.describeGroups(ids)
  const committed = await mapLimited(ids, 8, async (groupId) => {
    try {
      return await admin.fetchOffsets({ groupId })
    } catch {
      return []
    }
  })
  const ends = await endOffsets(admin, committed.flat().map((t) => t.topic))
  return described
    .map((g) => {
      const commits = committed[ids.indexOf(g.groupId)] || []
      let lag = 0
      for (const t of commits) {
        for (const p of t.partitions) {
          const end = ends.get(t.topic)?.get(p.partition)?.high
          if (end !== undefined && Number(p.offset) >= 0) lag += Math.max(end - Number(p.offset), 0)
        }
      }
      const topics = new Set(commits.map((t) => t.topic))
      for (const m of g.members) for (const t of Object.keys(assignmentOf(m))) topics.add(t)
      return { id: g.groupId, state: g.state, protocol: g.protocol, members: g.members.length, topics: [...topics].sort(), lag }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

async function describeGroup(conn, groupId) {
  return withAdmin(conn, groupId, async (admin) => {
    const { groups } = await admin.describeGroups([groupId])
    const g = groups[0]
    if (!g || g.state === 'Dead') {
      const commits = await admin.fetchOffsets({ groupId }).catch(() => [])
      if (!commits.length) throw Object.assign(new Error(`Consumer group "${groupId}" does not exist.`), { status: 404 })
    }
    const owner = new Map() // "topic:partition" → member
    const members = (g?.members || []).map((m) => {
      const assignment = assignmentOf(m)
      for (const [t, parts] of Object.entries(assignment)) for (const p of parts) owner.set(`${t}:${p}`, m)
      return { memberId: m.memberId, clientId: m.clientId, host: m.clientHost, assignment }
    })
    const commits = await admin.fetchOffsets({ groupId })
    const assignedTopics = Object.keys(Object.assign({}, ...members.map((m) => m.assignment)))
    const ends = await endOffsets(admin, [...commits.map((t) => t.topic), ...assignedTopics])

    const rows = new Map()
    for (const t of commits) {
      for (const p of t.partitions) rows.set(`${t.topic}:${p.partition}`, { topic: t.topic, partition: p.partition, committed: Number(p.offset) })
    }
    for (const key of owner.keys()) {
      if (!rows.has(key)) {
        const [topic, partition] = [key.slice(0, key.lastIndexOf(':')), Number(key.slice(key.lastIndexOf(':') + 1))]
        rows.set(key, { topic, partition, committed: -1 })
      }
    }
    const offsets = [...rows.entries()]
      .map(([key, r]) => {
        const end = ends.get(r.topic)?.get(r.partition)?.high ?? null
        const m = owner.get(key)
        return {
          ...r,
          end,
          lag: end === null || r.committed < 0 ? null : Math.max(end - r.committed, 0),
          member: m ? m.clientId : null,
          host: m ? m.clientHost : null,
        }
      })
      .sort((a, b) => a.topic.localeCompare(b.topic) || a.partition - b.partition)
    return {
      id: groupId,
      state: g?.state || 'Empty',
      protocol: g?.protocol || null,
      members,
      offsets,
      lag: offsets.reduce((n, o) => n + (o.lag || 0), 0),
    }
  })
}

const RESET_STRATEGIES = new Set(['earliest', 'latest', 'timestamp', 'offset', 'shift'])

/**
 * Move a group's committed offsets on one topic. Always computes the
 * before → after table first; `dryRun` stops there. Kafka only accepts a reset
 * for a group with no active members, so a live group is refused with the
 * members still connected rather than failing at the broker.
 */
async function resetOffsets(conn, groupId, { topic, partitions, strategy, value, dryRun = true } = {}) {
  if (!topic) throw Object.assign(new Error('A topic is required.'), { status: 400 })
  if (!RESET_STRATEGIES.has(strategy)) throw Object.assign(new Error('strategy must be earliest, latest, timestamp, offset or shift.'), { status: 400 })
  return withAdmin(conn, topic, async (admin) => {
    const ends = new Map((await admin.fetchTopicOffsets(topic)).map((o) => [o.partition, { low: Number(o.low), high: Number(o.high) }]))
    const only = Array.isArray(partitions) && partitions.length ? new Set(partitions.map(Number)) : null
    const targets = [...ends.keys()].filter((p) => !only || only.has(p)).sort((a, b) => a - b)
    const current = new Map()
    for (const t of await admin.fetchOffsets({ groupId, topics: [topic] })) {
      for (const p of t.partitions) current.set(p.partition, Number(p.offset))
    }
    let byTime = null
    if (strategy === 'timestamp') {
      const ms = /^\d+$/.test(String(value)) ? Number(value) : Date.parse(value)
      if (Number.isNaN(ms)) throw Object.assign(new Error(`"${value}" is not a timestamp.`), { status: 400 })
      byTime = new Map((await admin.fetchTopicOffsetsByTimestamp(topic, ms)).map((o) => [o.partition, Number(o.offset)]))
    }
    const n = Number(value)
    if ((strategy === 'offset' || strategy === 'shift') && !Number.isFinite(n)) {
      throw Object.assign(new Error(`${strategy === 'offset' ? 'An offset' : 'A shift'} must be a number.`), { status: 400 })
    }

    const rows = targets.map((partition) => {
      const { low, high } = ends.get(partition)
      const now = current.has(partition) && current.get(partition) >= 0 ? current.get(partition) : null
      let target =
        strategy === 'earliest' ? low :
        strategy === 'latest' ? high :
        strategy === 'timestamp' ? (byTime.get(partition) >= 0 ? byTime.get(partition) : high) :
        strategy === 'offset' ? n :
        (now ?? low) + n
      target = Math.min(Math.max(target, low), high)
      return { partition, current: now, target, delta: now === null ? null : target - now }
    })

    if (dryRun) return { topic, strategy, dryRun: true, offsets: rows }

    const { groups } = await admin.describeGroups([groupId])
    const g = groups[0]
    if (g && g.members.length) {
      throw Object.assign(
        new Error(`Group "${groupId}" is ${g.state} with ${g.members.length} member(s) (${g.members.map((m) => m.clientId).join(', ')}). Stop the consumers first — Kafka only resets an empty group.`),
        { status: 409, reason: 'group_active' }
      )
    }
    await admin.setOffsets({ groupId, topic, partitions: rows.map((r) => ({ partition: r.partition, offset: String(r.target) })) })
    return { topic, strategy, dryRun: false, offsets: rows }
  })
}

async function deleteGroup(conn, groupId) {
  await withAdmin(conn, groupId, async (admin) => {
    const [result] = await admin.deleteGroups([groupId])
    if (result?.error) throw result.error
  })
  return { ok: true }
}

// ---- The console (runQuery) ----------------------------------------------------

const rowsOf = (columns, rows) => (rows.length ? { type: 'rows', columns, rows } : { type: 'message', message: '(no rows)' })

async function execCommand(conn, command) {
  switch (command.op) {
    case 'topics': {
      const topics = await listTopics(conn, command)
      return rowsOf(['topic', 'partitions', 'replication', 'under_replicated'], topics.map((t) => ({
        topic: t.name, partitions: t.partitions, replication: t.replication, under_replicated: t.underReplicated,
      })))
    }
    case 'describe': {
      const t = await describeTopic(conn, command.topic)
      return rowsOf(['partition', 'leader', 'replicas', 'isr', 'earliest', 'latest', 'messages'], t.partitionList.map((p) => ({
        partition: p.partition, leader: p.leader, replicas: p.replicas.join(','), isr: p.isr.join(','), earliest: p.low, latest: p.high, messages: p.messages,
      })))
    }
    case 'config': {
      if (command.set) {
        await alterTopic(conn, command.topic, { configs: command.set })
        return { type: 'message', message: `Updated ${Object.keys(command.set).length} config(s) on ${command.topic}.` }
      }
      const t = await describeTopic(conn, command.topic)
      return rowsOf(['config', 'value', 'default'], t.configs.map((c) => ({ config: c.name, value: c.sensitive ? '(sensitive)' : c.value, default: c.isDefault })))
    }
    case 'consume': {
      const { columns, rows } = await readMessages(conn, { ...command, filter: command.where })
      return rowsOf(columns, rows)
    }
    case 'produce': {
      const r = await produce(conn, command)
      return { type: 'message', message: `Sent to ${r.topic} · partition ${r.partition} @ offset ${r.offset}` }
    }
    case 'groups': {
      const groups = await listGroups(conn)
      return rowsOf(['group', 'state', 'members', 'lag', 'topics'], groups.map((g) => ({ group: g.id, state: g.state, members: g.members, lag: g.lag, topics: g.topics.join(', ') })))
    }
    case 'lag': {
      const g = await describeGroup(conn, command.group)
      return rowsOf(['topic', 'partition', 'committed', 'end', 'lag', 'member'], g.offsets.map((o) => ({
        topic: o.topic, partition: o.partition, committed: o.committed < 0 ? null : o.committed, end: o.end, lag: o.lag, member: o.member,
      })))
    }
    case 'cluster': {
      const o = await overview(conn)
      return rowsOf(['node_id', 'host', 'port', 'controller', 'cluster_id'], o.brokers.map((b) => ({
        node_id: b.nodeId, host: b.host, port: b.port, controller: b.nodeId === o.controller, cluster_id: o.clusterId,
      })))
    }
    case 'createTopic':
      await createTopic(conn, command)
      return { type: 'message', message: `Created topic ${command.name}.` }
    case 'dropTopic':
      await deleteTopic(conn, command.name)
      return { type: 'message', message: `Deleted topic ${command.name}.` }
    default:
      throw new Error(`Unsupported command: ${command.op}`)
  }
}

const flat = (r) => (r.type === 'rows' ? `${r.rows.length} row(s)` : r.message)

// One command gets its full result; a buffer of several gets one summary row
// per command, so a failure in the middle is visible instead of aborting.
export async function runKafkaCommands(conn, text) {
  const lines = splitCommands(text)
  if (!lines.length) return { error: 'No command to run.' }
  if (lines.length === 1) {
    try {
      return await execCommand(conn, parseCommand(lines[0]))
    } catch (error) {
      return { error: routeError(error).message }
    }
  }
  const rows = []
  for (const [i, line] of lines.entries()) {
    try {
      rows.push({ '#': i + 1, command: line, status: 'OK', reply: flat(await execCommand(conn, parseCommand(line))) })
    } catch (error) {
      rows.push({ '#': i + 1, command: line, status: 'ERROR', reply: routeError(error).message })
    }
  }
  return { type: 'rows', columns: ['#', 'command', 'status', 'reply'], rows }
}

// ---- Driver --------------------------------------------------------------------

export const kafkaDriver = {
  type: 'kafka',
  label: 'Kafka',
  defaultPort: DEFAULT_PORT,
  // Schemaless — no schema designer, no table browser.
  dataTypes: [],

  async testConnection(config) {
    // A throwaway client under its own id, so a bad form never leaves a pool.
    const probe = { ...config, id: `test:${randomUUID()}` }
    try {
      const o = await overview(probe)
      return {
        ok: true,
        message: `Connected to Kafka cluster ${o.clusterId} · ${o.brokers.length} broker(s) · ${o.topicCount} topic(s).`,
      }
    } catch (error) {
      const explained = kafkaDriver.explainError(error, config)
      return { ok: false, message: explained ? `${explained.cause} ${explained.hint}` : rootCause(error).message || error.message }
    } finally {
      closeKafkaClients(probe.id)
    }
  },

  // What only Kafka can explain: SASL, ACLs, and the classic advertised-listener
  // trap — the bootstrap broker answers, then hands back broker addresses this
  // server can't reach. Transport failures are classified from the root cause,
  // which kafkajs buries a few errors deep.
  explainError(error, stored = {}) {
    const cause = rootCause(error)
    // The diagnosis names `host` as the target; a bootstrap-only form has none yet.
    const conn = stored.host ? stored : { ...stored, host: brokersOf(stored)[0] || '' }
    const text = `${error?.name} ${error?.type || ''} ${error?.message} ${cause?.name} ${cause?.type || ''} ${cause?.message}`
    if (/SASL|Authentication failed|SaslAuthenticate/i.test(text)) {
      return {
        reason: 'auth',
        cause: 'The brokers rejected the SASL login.',
        hint: 'Check the username, password and mechanism (PLAIN / SCRAM-SHA-256 / SCRAM-SHA-512) — managed clusters usually need SASL_SSL, i.e. TLS on as well.',
      }
    }
    if (/AUTHORIZATION_FAILED|not authorized/i.test(text)) {
      return {
        reason: 'permission',
        cause: 'The cluster refused this user (an ACL denies the request).',
        hint: 'Grant at least DESCRIBE on the cluster and the topics you want to browse; producing needs WRITE, groups need DESCRIBE/READ.',
      }
    }
    if (/is not supported/i.test(error?.message || '') && error?.status === 400) {
      return { reason: 'unsupported', cause: error.message, hint: 'Pick another SASL mechanism in the connection settings.' }
    }
    const transport = classifyTransport(cause, conn)
    const broker = cause?.broker || error?.broker
    if (transport && broker && !brokersOf(conn).includes(broker) && !conn.forwardPort) {
      return {
        reason: transport.reason,
        cause: `The bootstrap broker answered, but the cluster advertises ${broker}, which this server can't reach.`,
        hint: "Kafka clients connect to the addresses brokers advertise (advertised.listeners), not the bootstrap list. Advertise an address this server can reach, or connect through an SSH host that can.",
      }
    }
    if (transport) return transport
    if (/ssl|tls|certificate|EPROTO/i.test(text)) {
      return {
        reason: 'tls',
        cause: 'The TLS handshake with the brokers failed.',
        hint: 'Turn TLS on for an SSL/SASL_SSL listener (or off for a PLAINTEXT one); for a private CA paste its certificate, or skip verification for a self-signed one you trust.',
      }
    }
    if (/Connection error|Closed connection|ECONNRESET/i.test(text)) {
      return {
        reason: 'network',
        cause: 'The broker closed the connection during the handshake.',
        hint: 'Often TLS against a PLAINTEXT listener (or the reverse), or SASL missing on a listener that requires it.',
      }
    }
    return null
  },

  release: (conn) => closeKafkaClients(conn.id),
  closeAll: () => closeAllKafkaClients(),

  async ping(conn) {
    await withAdmin(conn, null, (admin) => admin.describeCluster())
    return { ok: true }
  },

  // Kafka's protocol never states a release, but a 3.x broker reports the
  // protocol version it speaks ("3.7-IV4") as inter.broker.protocol.version.
  // Kafka 4 dropped that config, and an ACL may forbid DescribeConfigs — null then.
  async serverVersion(conn) {
    return withAdmin(conn, null, async (admin) => {
      const { controller } = await admin.describeCluster()
      const { resources } = await admin.describeConfigs({
        includeSynonyms: false,
        resources: [{ type: ConfigResourceTypes.BROKER, name: String(controller), configNames: ['inter.broker.protocol.version'] }],
      })
      const value = resources[0]?.configEntries?.[0]?.configValue || ''
      return /^\d+\.\d+(\.\d+)?/.exec(value)?.[0] || null
    }).catch(() => null)
  },

  // No databases or schemas — the console hides its namespace picker.
  namespaces: () => ({ databases: [], schemas: [], currentDatabase: null }),

  runQuery: (conn, ctx, text) => runKafkaCommands(conn, text),

  // ---- The stream capability (see the contract in ./index.js) ----
  streamOverview: (conn) => overview(conn),
  listTopics: (conn, ctx, options) => listTopics(conn, options),
  describeTopic: (conn, ctx, topic) => describeTopic(conn, topic),
  createTopic: (conn, ctx, spec) => createTopic(conn, spec),
  alterTopic: (conn, ctx, topic, change) => alterTopic(conn, topic, change),
  deleteTopic: (conn, ctx, topic) => deleteTopic(conn, topic),
  readMessages: (conn, ctx, options) => readMessages(conn, options),
  produce: (conn, ctx, message) => produce(conn, message),
  listGroups: (conn) => listGroups(conn),
  describeGroup: (conn, ctx, groupId) => describeGroup(conn, groupId),
  resetOffsets: (conn, ctx, groupId, spec) => resetOffsets(conn, groupId, spec),
  deleteGroup: (conn, ctx, groupId) => deleteGroup(conn, groupId),
}
