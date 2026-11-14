import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'

// The db layer reads config (and so the env) on import; keep it off real paths.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabletsgo-query-paging-'))
process.env.ENCRYPTION_KEY = 'query-paging-test-key'
process.env.DATA_DIR = dir
const { runQuery } = await import('../server/db/index.js')

const filepath = path.join(dir, 'paging.sqlite')
const handle = new Database(filepath)
handle.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);
  INSERT INTO items (name) VALUES ('a'), ('b'), ('c'), ('d'), ('e');`)
handle.close()
const conn = { id: 'conn-paging', type: 'sqlite', name: 'paging', filepath }
const ids = (r) => r.rows.map((row) => (Array.isArray(row) ? row[0] : row.id ?? Object.values(row)[0]))

test('a page of a plain SELECT is narrowed in the statement', async () => {
  const r = await runQuery(conn, {}, 'SELECT id FROM items ORDER BY id', { page: { limit: 2, offset: 2 } })
  assert.equal(r.type, 'rows')
  assert.deepEqual(ids(r), [3, 4])
})

test('a statement that cannot be wrapped is run as written and sliced', async () => {
  // PRAGMA can't be a derived table; dashboard tables page by default, so it must still page.
  const r = await runQuery(conn, {}, 'PRAGMA table_info(items)', { page: { limit: 1, offset: 1 } })
  assert.ok(!r.error, r.error)
  assert.equal(r.type, 'rows')
  assert.equal(r.rows.length, 1)
})

test('a wrong statement reports its own error, not the wrapper’s', async () => {
  const r = await runQuery(conn, {}, 'SELECT nope FROM items', { page: { limit: 2, offset: 0 } })
  assert.ok(r.error)
  assert.doesNotMatch(String(r.error), /_page/)
})
