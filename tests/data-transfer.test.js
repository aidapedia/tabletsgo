import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'

// The db layer reads config (and so the env) on import; keep it off real paths.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabletsgo-data-transfer-'))
process.env.ENCRYPTION_KEY = 'data-transfer-test-key'
process.env.DATA_DIR = dir
const { detectFormat, parseCsv, planExport, previewImport, runImport, tableFromFilename } = await import('../server/data-transfer.js')

const ctx = {}
let n = 0
// A SQLite connection on a fresh file, seeded with `sql`.
function sqliteConn(sql = '') {
  const filepath = path.join(dir, `db-${++n}.sqlite`)
  const handle = new Database(filepath)
  if (sql) handle.exec(sql)
  handle.close()
  return { id: `conn-${n}`, type: 'sqlite', name: 'test conn', filepath }
}
const readAll = async (plan) => {
  let text = ''
  for await (const chunk of plan.chunks) text += chunk
  return text
}
const query = (conn, sql) => {
  const handle = new Database(conn.filepath)
  try {
    return handle.prepare(sql).all()
  } finally {
    handle.close()
  }
}

const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, meta TEXT);
  CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), body TEXT, data BLOB);
  CREATE INDEX idx_posts_user ON posts(user_id);
`
function seeded() {
  const conn = sqliteConn(SCHEMA)
  const handle = new Database(conn.filepath)
  const insert = handle.prepare('INSERT INTO users (name, meta) VALUES (?, ?)')
  // More than one read page, with values CSV and SQL both have to escape.
  for (let i = 0; i < 2500; i++) insert.run(`user "${i}", o'k\nline`, i % 2 ? null : '{"x":1}')
  handle.prepare('INSERT INTO posts (user_id, body, data) VALUES (1, ?, ?)').run('hello, world', Buffer.from([1, 2, 255]))
  handle.close()
  return conn
}

test('a SQL export with schema replays into an empty database, parents first', async () => {
  const source = seeded()
  const sql = await readAll(await planExport(source, ctx, { tables: ['posts', 'users'], format: 'sql', includeSchema: true }))
  assert.ok(sql.indexOf('CREATE TABLE IF NOT EXISTS users') < sql.indexOf('CREATE TABLE IF NOT EXISTS posts'))
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_posts_user/)

  const target = sqliteConn()
  const result = await runImport(target, ctx, { filename: 'export.sql', text: sql })
  assert.equal(result.kind, 'script')
  assert.equal(query(target, 'SELECT count(*) AS c FROM users')[0].c, 2500)
  assert.deepEqual(query(target, 'SELECT data FROM posts')[0].data, Buffer.from([1, 2, 255]))
})

test('a JSON export recreates its missing tables from its own schema', async () => {
  const source = seeded()
  const json = await readAll(await planExport(source, ctx, { tables: ['users', 'posts'], format: 'json', includeSchema: true }))
  const target = sqliteConn()

  const preview = await previewImport(target, ctx, { filename: 'whatever.json', text: json })
  assert.deepEqual(
    preview.tables.map((t) => [t.table, t.total, t.exists, t.schemaFrom]),
    [['users', 2500, false, 'file'], ['posts', 1, false, 'file']]
  )
  await assert.rejects(runImport(target, ctx, { filename: 'whatever.json', text: json, createTables: false }), /No such tables: users, posts/)

  const result = await runImport(target, ctx, { filename: 'whatever.json', text: json })
  assert.deepEqual(result.created, ['users', 'posts'])
  assert.equal(query(target, 'SELECT count(*) AS c FROM users')[0].c, 2500)
  assert.match(query(target, "SELECT sql FROM sqlite_master WHERE name = 'users'")[0].sql, /name TEXT NOT NULL/)
})

test('a CSV goes into the table named after its file, created with inferred types when missing', async () => {
  const target = sqliteConn()
  const csv = 'id,price,active,zip,note\n1,9.5,true,00123,hi\n2,10,false,12345,\n'
  const preview = await previewImport(target, ctx, { filename: 'products-2026-10-02.csv', text: csv })
  assert.equal(preview.format, 'csv')
  assert.equal(preview.tables[0].table, 'products')
  assert.deepEqual(preview.tables[0].types, { id: 'INTEGER', price: 'DOUBLE PRECISION', active: 'BOOLEAN', zip: 'TEXT', note: 'TEXT' })

  await runImport(target, ctx, { filename: 'products-2026-10-02.csv', text: csv })
  assert.deepEqual(query(target, 'SELECT * FROM products ORDER BY id'), [
    { id: 1, price: 9.5, active: 1, zip: '00123', note: 'hi' },
    { id: 2, price: 10, active: 0, zip: '12345', note: null },
  ])
})

test('an existing table is matched whatever the letter case of the file name', async () => {
  const target = sqliteConn(SCHEMA)
  const preview = await previewImport(target, ctx, { filename: 'Users.json', text: '[{"name":"Ada"}]' })
  assert.deepEqual([preview.tables[0].table, preview.tables[0].exists], ['users', true])
})

test('CSV round-trips quotes, commas and line breaks, and a failed import rolls back', async () => {
  const source = seeded()
  const csv = await readAll(await planExport(source, ctx, { tables: ['users'], format: 'csv' }))
  const target = sqliteConn(SCHEMA)

  await runImport(target, ctx, { filename: 'users.csv', text: csv })
  const first = query(target, 'SELECT * FROM users WHERE id = 1')[0]
  assert.deepEqual(first, { id: 1, name: `user "0", o'k\nline`, meta: '{"x":1}' })
  assert.equal(query(target, 'SELECT meta FROM users WHERE id = 2')[0].meta, null)

  // Same ids again: the primary key refuses, and none of the batch lands.
  await assert.rejects(runImport(target, ctx, { filename: 'users.csv', text: csv }), /UNIQUE constraint failed/)
  assert.equal(query(target, 'SELECT count(*) AS c FROM users')[0].c, 2500)
})

test('a preview export caps rows per table; unknown tables and multi-table CSV are refused', async () => {
  const source = seeded()
  const json = await readAll(await planExport(source, ctx, { tables: ['users'], format: 'json', limit: 50 }))
  assert.equal(JSON.parse(json).tables[0].rows.length, 50)

  await assert.rejects(planExport(source, ctx, { tables: ['nope"; DROP TABLE users; --'], format: 'sql' }), /Unknown table/)
  await assert.rejects(planExport(source, ctx, { tables: ['users', 'posts'], format: 'csv' }), /one table/)
})

test('the format and table come from the file name, else its content', () => {
  assert.equal(tableFromFilename('/tmp/orders-2026-01-31.sql'), 'orders')
  assert.equal(detectFormat('data.txt', '  [{"a":1}]'), 'json')
  assert.equal(detectFormat('dump', '-- hi\nCREATE TABLE x (a int);'), 'sql')
  assert.equal(detectFormat('rows', 'a,b\n1,2'), 'csv')
  assert.equal(detectFormat('rows.csv', '[1]', 'json'), 'json')
})

test('parseCsv handles quoted fields and CRLF', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, ""y""","line\nbreak"\r\n'), [
    ['a', 'b'],
    ['x, "y"', 'line\nbreak'],
  ])
})
