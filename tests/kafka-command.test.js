import assert from 'node:assert/strict'
import test from 'node:test'
import { compileFilter, parseCommand, splitCommands, topicMatcher } from '../server/db/kafka-command.js'

// The Kafka console's grammar and the WHERE filter the topic browser shares.
// Pure parsing — no broker needed.

const message = (over = {}) => {
  const value = over.value ?? JSON.stringify({ orderId: 'ord_1', amount: 129.5, method: 'card', nested: { ok: true } })
  return {
    partition: 3,
    offset: 1204861,
    timestamp: Date.parse('2026-10-29T09:41:07Z'),
    key: 'ord_1',
    headers: { source: 'checkout-api' },
    ...over,
    value,
    json: () => {
      try {
        return JSON.parse(value)
      } catch {
        return null
      }
    },
  }
}

test('splitCommands drops blank lines and # comments', () => {
  assert.deepEqual(splitCommands('# hi\n\nTOPICS\n  GROUPS  \n#x'), ['TOPICS', 'GROUPS'])
})

test('TOPICS takes an optional LIKE pattern and INTERNAL', () => {
  assert.deepEqual(parseCommand('topics'), { op: 'topics', pattern: '', internal: false })
  assert.deepEqual(parseCommand("TOPICS LIKE 'orders.*' INTERNAL"), { op: 'topics', pattern: 'orders.*', internal: true })
})

test('DESCRIBE reads a topic, DESCRIBE GROUP a group', () => {
  assert.deepEqual(parseCommand('DESCRIBE orders.paid'), { op: 'describe', topic: 'orders.paid' })
  assert.deepEqual(parseCommand('DESCRIBE TOPIC orders.paid'), { op: 'describe', topic: 'orders.paid' })
  assert.deepEqual(parseCommand('DESCRIBE GROUP payments'), { op: 'lag', group: 'payments' })
})

test('GROUPS lists every group, or only those reading one TOPIC', () => {
  assert.deepEqual(parseCommand('GROUPS'), { op: 'groups' })
  assert.deepEqual(parseCommand('groups topic orders.created'), { op: 'groups', topic: 'orders.created' })
  assert.throws(() => parseCommand('GROUPS TOPIC'), /topic name/)
  assert.throws(() => parseCommand('GROUPS TOPIC orders extra'), /Unexpected "extra"/)
})

test('CONFIG reads or sets key=value pairs', () => {
  assert.deepEqual(parseCommand('CONFIG t'), { op: 'config', topic: 't' })
  assert.deepEqual(parseCommand("CONFIG t SET retention.ms=1000, cleanup.policy='compact'"), {
    op: 'config',
    topic: 't',
    set: { 'retention.ms': '1000', 'cleanup.policy': 'compact' },
  })
  assert.throws(() => parseCommand('CONFIG t SET'), /at least one/)
})

test('CONSUME parses every clause, and WHERE owns the rest of the line', () => {
  const c = parseCommand("CONSUME orders.paid PARTITION 3 FROM -20 LIMIT 5 DECODE hex WHERE key = 'a b' AND value.amount > 10")
  assert.equal(c.op, 'consume')
  assert.equal(c.topic, 'orders.paid')
  assert.equal(c.partition, 3)
  assert.equal(c.from, '-20')
  assert.equal(c.limit, 5)
  assert.equal(c.decode, 'hex')
  assert.equal(c.where, "key = 'a b' AND value.amount > 10")
  assert.equal(parseCommand('CONSUME t FROM OFFSET 42').from, 'offset:42')
  assert.equal(parseCommand("CONSUME t FROM '2026-10-29T08:00:00Z'").from, 'ts:2026-10-29T08:00:00Z')
  assert.equal(parseCommand('CONSUME t FROM beginning').from, 'earliest')
  assert.throws(() => parseCommand('CONSUME t FROM yesterday'), /Unknown FROM/)
  assert.throws(() => parseCommand('CONSUME t WHERE nope = 1'), /Unknown field/)
})

test('PRODUCE: key, headers JSON, and a VALUE that keeps the rest of the line', () => {
  const p = parseCommand('PRODUCE t PARTITION 2 KEY \'ord 1\' HEADERS {"source":"console"} VALUE {"a": "x y", "b": [1, 2]}')
  assert.deepEqual(p, { op: 'produce', topic: 't', partition: 2, key: 'ord 1', headers: { source: 'console' }, value: '{"a": "x y", "b": [1, 2]}' })
  assert.equal(parseCommand('PRODUCE t VALUE null').value, null)
  assert.equal(parseCommand("PRODUCE t VALUE 'hello world'").value, 'hello world')
  assert.equal(parseCommand('PRODUCE t VALUE plain text here').value, 'plain text here')
  assert.throws(() => parseCommand('PRODUCE t KEY k'), /needs a VALUE/)
  assert.throws(() => parseCommand('PRODUCE t HEADERS [1] VALUE 1'), /JSON object/)
})

test('a doubled quote is a literal quote (the workflow node renders SQL-style literals)', () => {
  assert.equal(parseCommand("PRODUCE t KEY 'it''s' VALUE 1").key, "it's")
})

test('CREATE TOPIC and DROP TOPIC, which insists on CONFIRM', () => {
  assert.deepEqual(parseCommand('CREATE TOPIC a.b PARTITIONS 12 REPLICATION 3 WITH retention.ms=604800000'), {
    op: 'createTopic',
    name: 'a.b',
    partitions: 12,
    replication: 3,
    configs: { 'retention.ms': '604800000' },
  })
  assert.throws(() => parseCommand('DROP TOPIC a.b'), /DROP TOPIC a\.b CONFIRM/)
  assert.deepEqual(parseCommand('DROP TOPIC a.b CONFIRM'), { op: 'dropTopic', name: 'a.b' })
})

test('unknown commands and stray tokens explain themselves', () => {
  assert.throws(() => parseCommand('SELECT 1'), /Unknown command "SELECT"/)
  assert.throws(() => parseCommand('GROUPS now'), /Unexpected "now"/)
  assert.throws(() => parseCommand("CONSUME t WHERE key = 'x"), /Unterminated quote/)
})

test('filters compare keys, JSON paths, headers and positions', () => {
  const m = message()
  assert.equal(compileFilter('')(m), true)
  assert.equal(compileFilter("key = 'ord_1'")(m), true)
  assert.equal(compileFilter("key != 'ord_1'")(m), false)
  assert.equal(compileFilter('value.amount > 100')(m), true)
  assert.equal(compileFilter('value.amount >= 129.5 AND value.amount < 130')(m), true)
  assert.equal(compileFilter("value.method = 'bank'")(m), false)
  assert.equal(compileFilter('value.nested.ok = true')(m), true)
  assert.equal(compileFilter("header.source ~ 'CHECKOUT'")(m), true)
  assert.equal(compileFilter("value contains 'ord_1'")(m), true)
  assert.equal(compileFilter('partition = 3 AND offset > 1204000')(m), true)
  assert.equal(compileFilter("timestamp >= '2026-10-29T09:00:00Z'")(m), true)
  assert.equal(compileFilter('value.missing = null')(m), true)
  assert.equal(compileFilter('value.missing != null')(m), false)
})

test('filters survive non-JSON and tombstone values', () => {
  assert.equal(compileFilter("value ~ 'plain'")(message({ value: 'plain text' })), true)
  assert.equal(compileFilter('value.amount > 1')(message({ value: 'plain text' })), false)
  const tombstone = { ...message(), value: null, json: () => null }
  assert.equal(compileFilter('value = null')(tombstone), true)
  assert.equal(compileFilter("value ~ 'x'")(tombstone), false)
})

test('topicMatcher: globs, or a case-insensitive substring', () => {
  assert.equal(topicMatcher('orders.*')('orders.paid'), true)
  assert.equal(topicMatcher('orders.*')('xorders.paid'), false)
  assert.equal(topicMatcher('PAID')('orders.paid'), true)
  assert.equal(topicMatcher('')('anything'), true)
})
