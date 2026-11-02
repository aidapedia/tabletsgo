import assert from 'node:assert/strict'
import test from 'node:test'

// How KSQL text is cut into statements before it reaches ksqlDB. Pure — no server.

process.env.ENCRYPTION_KEY = 'kafka-ksql-test-key'
const { splitStatements } = await import('../server/db/kafka-ksql.js')

test('statements split on semicolons, and empty ones are dropped', () => {
  assert.deepEqual(splitStatements('SHOW STREAMS; SHOW TABLES;;\n'), ['SHOW STREAMS', 'SHOW TABLES'])
  assert.deepEqual(splitStatements('SELECT * FROM pv EMIT CHANGES'), ['SELECT * FROM pv EMIT CHANGES'])
})

test('a semicolon inside quotes or a comment does not end a statement', () => {
  assert.deepEqual(splitStatements("CREATE STREAM s (x VARCHAR) WITH (KAFKA_TOPIC='a;b', VALUE_FORMAT='JSON');"), [
    "CREATE STREAM s (x VARCHAR) WITH (KAFKA_TOPIC='a;b', VALUE_FORMAT='JSON')",
  ])
  assert.deepEqual(splitStatements('-- drop it; later\nDROP STREAM `odd;name`;'), ['DROP STREAM `odd;name`'])
})
