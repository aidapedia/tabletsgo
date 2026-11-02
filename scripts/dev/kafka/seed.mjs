/**
 * Fill a local Kafka stack (scripts/dev/kafka/stack.sh) with sample data for
 * the console — through the app's own Kafka modules, so seeding exercises them.
 *
 *   node --env-file=.env scripts/dev/kafka/seed.mjs <stack N> [--from <brokers>]
 *
 * - Copies every topic of another cluster (`--from`, default localhost:39092 —
 *   the docker-compose dev Kafka) with its partitions, configs and messages
 *   (keys, values byte for byte, headers, partitions, timestamps), and its
 *   consumer groups' committed offsets, so lag shows the same.
 * - Adds the ecosystem samples: Avro / Protobuf / JSON Schema subjects with
 *   topics written in them, Kafka Connect connectors (running, paused and one
 *   with a failed task), ksqlDB streams and a table, and ACLs.
 *
 * Re-running is safe: a topic that already has messages is not written again,
 * schemas register to the same ids, connectors and ACLs are upserted.
 */

import { createRequire } from 'module'
import { kafkaDriver as kafka } from '../../../server/db/kafka.js'
import { serializeWithSchema } from '../../../server/db/kafka-registry.js'

const require = createRequire(import.meta.url)
const { Kafka, logLevel } = require('kafkajs')

const args = process.argv.slice(2)
const n = Number(args[0])
if (![1, 2, 3].includes(n)) {
  console.error('Usage: node --env-file=.env scripts/dev/kafka/seed.mjs <stack 1|2|3> [--from <brokers>]')
  process.exit(1)
}
const fromAt = args.indexOf('--from')
const sourceBrokers = fromAt >= 0 ? args[fromAt + 1] : 'localhost:39092'

const target = {
  id: `seed:${n}`,
  type: 'kafka',
  brokers: `localhost:${39095 + n}`,
  schemaRegistryUrl: `http://localhost:${37981 + 100 * n}`,
  connectUrl: `http://localhost:${37983 + 100 * n}`,
  ksqlUrl: `http://localhost:${37988 + 100 * n}`,
}
const source = { id: 'seed:source', type: 'kafka', brokers: sourceBrokers }
const ctx = {}
const say = (...a) => console.log(' ', ...a)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const client = new Kafka({ clientId: 'tabletsgo-seed', brokers: [target.brokers], logLevel: logLevel.NOTHING })
const producer = client.producer({ allowAutoTopicCreation: false })
const admin = client.admin()

// A topic is (re)filled only while it's empty, so a re-run doesn't double it.
async function ensureTopic(name, partitions, configs = {}) {
  const exists = (await kafka.listTopics(target, ctx, { internal: true })).some((t) => t.name === name)
  if (!exists) await kafka.createTopic(target, ctx, { name, partitions, replication: 1, configs })
  return (await kafka.describeTopic(target, ctx, name)).messages === 0
}

// ---- 1. Copy another cluster ------------------------------------------------------

async function copyCluster() {
  let topics
  try {
    topics = await kafka.listTopics(source, ctx, {})
  } catch (error) {
    console.log(`Skipping the copy — ${sourceBrokers} is not reachable (${error.message}).`)
    return
  }
  console.log(`Copying ${topics.length} topic(s) from ${sourceBrokers}`)
  for (const t of topics) {
    const d = await kafka.describeTopic(source, ctx, t.name)
    const configs = Object.fromEntries(d.configs.filter((c) => !c.isDefault && !c.readOnly && !c.sensitive && c.value != null).map((c) => [c.name, c.value]))
    if (!(await ensureTopic(t.name, d.partitions, configs))) {
      say(`${t.name}: already has messages, left as it is`)
      continue
    }
    let copied = 0
    for (const p of d.partitionList) {
      // Read forward a page at a time; base64 keeps binary values exact.
      for (let at = p.low; at < p.high; ) {
        const page = await kafka.readMessages(source, ctx, { topic: t.name, partition: p.partition, from: `offset:${at}`, limit: 500, decode: 'base64' })
        if (!page.rows.length) break
        const rows = [...page.rows].sort((a, b) => a.offset - b.offset)
        await producer.send({
          topic: t.name,
          messages: rows.map((m) => ({
            partition: p.partition,
            key: m.key,
            value: m.value == null ? null : Buffer.from(m.value, 'base64'),
            headers: m.headers ? JSON.parse(m.headers) : undefined,
            timestamp: String(Date.parse(m.timestamp)),
          })),
        })
        copied += rows.length
        at = rows[rows.length - 1].offset + 1
      }
    }
    say(`${t.name}: ${d.partitions} partition(s), ${copied} message(s)`)
  }

  // Committed offsets, so each group shows the same lag as on the source.
  for (const g of await kafka.listGroups(source, ctx)) {
    if (g.id.startsWith('_')) continue
    const detail = await kafka.describeGroup(source, ctx, g.id)
    const byTopic = new Map()
    for (const o of detail.offsets) {
      if (o.committed < 0) continue
      byTopic.set(o.topic, [...(byTopic.get(o.topic) || []), { partition: o.partition, offset: String(o.committed) }])
    }
    for (const [topic, partitions] of byTopic) await admin.setOffsets({ groupId: g.id, topic, partitions })
    say(`group ${g.id}: offsets on ${[...byTopic.keys()].join(', ') || 'nothing committed'}`)
  }
}

// ---- 2. Schema Registry ----------------------------------------------------------------

const ORDER_AVRO = {
  type: 'record',
  name: 'Order',
  namespace: 'com.tabletsgo.demo',
  fields: [
    { name: 'id', type: 'string' },
    { name: 'customer', type: 'string' },
    { name: 'amount', type: 'double' },
    { name: 'currency', type: { type: 'enum', name: 'Currency', symbols: ['USD', 'EUR', 'IDR'] } },
    { name: 'items', type: { type: 'array', items: 'string' } },
    { name: 'note', type: ['null', 'string'], default: null },
  ],
}
const PAYMENT_PROTO = `syntax = "proto3";
package com.tabletsgo.demo;

import "google/protobuf/timestamp.proto";

message Payment {
  string id = 1;
  string order_id = 2;
  int64 amount_cents = 3;
  Method method = 4;
  google.protobuf.Timestamp at = 5;

  enum Method {
    CARD = 0;
    TRANSFER = 1;
    WALLET = 2;
  }
}
`
const AUDIT_JSON = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'AuditEvent',
  type: 'object',
  properties: { actor: { type: 'string' }, action: { type: 'string' }, at: { type: 'string', format: 'date-time' } },
  required: ['actor', 'action'],
}

const customers = ['ana', 'budi', 'citra', 'dewi', 'eko']
const pick = (list, i) => list[i % list.length]

async function seedSchemas() {
  console.log('Schema Registry')
  const subjects = [
    ['orders.avro-value', 'AVRO', JSON.stringify(ORDER_AVRO)],
    ['payments.proto-value', 'PROTOBUF', PAYMENT_PROTO],
    ['audit.json-value', 'JSON', JSON.stringify(AUDIT_JSON)],
  ]
  for (const [subject, type, schema] of subjects) {
    const r = await kafka.registerSchema(target, ctx, subject, { schema, type })
    say(`${subject}: ${type} v${r.version} (id ${r.id})`)
  }
  // A second, compatible Avro version, so a subject has history to browse.
  const v2 = { ...ORDER_AVRO, fields: [...ORDER_AVRO.fields, { name: 'channel', type: 'string', default: 'web' }] }
  const r = await kafka.registerSchema(target, ctx, 'orders.avro-value', { schema: JSON.stringify(v2), type: 'AVRO' })
  say(`orders.avro-value: v${r.version} adds "channel"`)
  await kafka.setSchemaCompatibility(target, ctx, 'payments.proto-value', 'FULL')

  const send = async (topic, partitions, count, schemaRef, make) => {
    if (!(await ensureTopic(topic, partitions))) return say(`${topic}: already has messages`)
    const messages = []
    for (let i = 0; i < count; i++) {
      const { key, value } = make(i)
      messages.push({ key, value: await serializeWithSchema(target, schemaRef, JSON.stringify(value)) })
    }
    await producer.send({ topic, messages })
    say(`${topic}: ${count} message(s) in ${schemaRef.subject}`)
  }
  await send('orders.avro', 3, 30, { subject: 'orders.avro-value' }, (i) => ({
    key: `ord_${1000 + i}`,
    value: {
      id: `ord_${1000 + i}`,
      customer: pick(customers, i),
      amount: Math.round((10 + ((i * 37) % 490)) * 100) / 100,
      currency: pick(['USD', 'EUR', 'IDR'], i),
      items: Array.from({ length: (i % 3) + 1 }, (_, j) => `sku_${(i + j) % 12}`),
      note: i % 4 === 0 ? 'gift wrap' : null,
      channel: pick(['web', 'app', 'store'], i),
    },
  }))
  await send('payments.proto', 2, 20, { subject: 'payments.proto-value' }, (i) => ({
    key: `pay_${2000 + i}`,
    value: {
      id: `pay_${2000 + i}`,
      order_id: `ord_${1000 + i}`,
      amount_cents: String(1000 + ((i * 731) % 49000)),
      method: pick(['CARD', 'TRANSFER', 'WALLET'], i),
      at: { seconds: String(1790000000 + i * 3600) },
    },
  }))
  await send('audit.json', 1, 15, { subject: 'audit.json-value' }, (i) => ({
    key: pick(customers, i),
    value: { actor: pick(customers, i), action: pick(['login', 'export', 'refund', 'settings.update'], i), at: new Date(1790000000000 + i * 60000).toISOString() },
  }))
}

// ---- 3. ksqlDB ---------------------------------------------------------------------------

async function seedKsql() {
  console.log('ksqlDB')
  if (await ensureTopic('pageviews', 1)) {
    await producer.send({
      topic: 'pageviews',
      messages: Array.from({ length: 60 }, (_, i) => {
        const user = pick(customers, i * 7)
        return { key: user, value: JSON.stringify({ user, page: pick(['/', '/pricing', '/docs', '/signup', '/blog'], i), ms: 20 + ((i * 53) % 900) }) }
      }),
    })
    say('pageviews: 60 message(s)')
  }
  const statements = [
    "CREATE STREAM IF NOT EXISTS PAGEVIEWS (USER VARCHAR KEY, PAGE VARCHAR, MS INT) WITH (KAFKA_TOPIC='pageviews', VALUE_FORMAT='JSON');",
    'CREATE TABLE IF NOT EXISTS PAGEVIEWS_PER_USER AS SELECT USER, COUNT(*) AS VIEWS, AVG(MS) AS AVG_MS FROM PAGEVIEWS GROUP BY USER EMIT CHANGES;',
    "CREATE STREAM IF NOT EXISTS ORDERS_AVRO WITH (KAFKA_TOPIC='orders.avro', VALUE_FORMAT='AVRO');",
    "CREATE STREAM IF NOT EXISTS BIG_ORDERS WITH (KAFKA_TOPIC='orders.big') AS SELECT ID, CUSTOMER, AMOUNT, CURRENCY FROM ORDERS_AVRO WHERE AMOUNT > 300 EMIT CHANGES;",
  ]
  const r = await kafka.runStreamSql(target, ctx, { sql: statements.join('\n'), properties: { 'auto.offset.reset': 'earliest' } })
  for (const x of r.results) say(`${x.statement.slice(0, 60)}… → ${x.type === 'message' ? x.message : `${x.rows.length} row(s)`}`)
}

// ---- 4. Kafka Connect --------------------------------------------------------------------

async function seedConnect() {
  console.log('Kafka Connect')
  const FILE_SINK = 'org.apache.kafka.connect.file.FileStreamSinkConnector'
  const FILE_SOURCE = 'org.apache.kafka.connect.file.FileStreamSourceConnector'
  const connectors = [
    ['pageviews-to-file', { 'connector.class': FILE_SINK, 'tasks.max': '1', topics: 'pageviews', file: '/tmp/pageviews.txt' }],
    ['audit-from-file', { 'connector.class': FILE_SOURCE, 'tasks.max': '1', file: '/tmp/audit-in.txt', topic: 'audit.log' }],
    ['orders-archive', { 'connector.class': FILE_SINK, 'tasks.max': '1', topics: 'orders.created,orders.paid', file: '/tmp/orders-archive.txt' }],
    // Fails on start: its directory doesn't exist — a task with a stack trace to look at.
    ['refunds-to-file-broken', { 'connector.class': FILE_SINK, 'tasks.max': '1', topics: 'orders.refunded', file: '/nonexistent/refunds.txt' }],
  ]
  for (const [name, config] of connectors) {
    await kafka.saveConnector(target, ctx, name, config)
    say(name)
  }
  await wait(3000)
  await kafka.connectorAction(target, ctx, 'orders-archive', { action: 'pause' })
  say('orders-archive: paused')
}

// ---- 5. ACLs -----------------------------------------------------------------------------

async function seedAcls() {
  console.log('ACLs')
  const allow = (principal, resourceType, resourceName, operations, patternType = 'LITERAL') =>
    operations.map((operation) => ({ principal, resourceType, resourceName, operation, patternType }))
  const acls = [
    // A consumer: everything under orders.*, and its group.
    ...allow('User:billing', 'TOPIC', 'orders.', ['READ', 'DESCRIBE'], 'PREFIXED'),
    ...allow('User:billing', 'GROUP', 'billing-service', ['READ']),
    // A producer.
    ...allow('User:checkout', 'TOPIC', 'orders.created', ['WRITE', 'DESCRIBE', 'CREATE']),
    ...allow('User:checkout', 'CLUSTER', 'kafka-cluster', ['IDEMPOTENT_WRITE']),
    // A Kafka Streams app.
    ...allow('User:enricher', 'TOPIC', 'orders.paid', ['READ', 'DESCRIBE']),
    ...allow('User:enricher', 'TOPIC', 'order-enricher', ['ALL'], 'PREFIXED'),
    ...allow('User:enricher', 'GROUP', 'order-enricher', ['READ']),
    // And someone kept out.
    { principal: 'User:intern', resourceType: 'TOPIC', resourceName: 'payments.', patternType: 'PREFIXED', operation: 'ALL', permission: 'DENY' },
  ]
  const r = await kafka.createAcls(target, ctx, acls)
  say(`${r.created} binding(s) for billing, checkout, enricher and intern`)
}

// ---------------------------------------------------------------------------------------------

try {
  console.log(`Seeding stack ${n} (${target.brokers})`)
  await producer.connect()
  await admin.connect()
  await copyCluster()
  await seedSchemas()
  await seedKsql()
  await seedConnect()
  await seedAcls()
  console.log('Done.')
} catch (error) {
  console.error(`Seeding failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await producer.disconnect().catch(() => {})
  await admin.disconnect().catch(() => {})
  kafka.closeAll()
  process.exit()
}
