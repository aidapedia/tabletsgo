import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import Database from 'better-sqlite3'
import { migrate, LATEST_VERSION } from '../server/migrations.js'
import { postgresSql } from '../server/postgres-sql.js'

test('metadata SQL translation keeps bound values and quoted question marks', () => {
  assert.equal(postgresSql("SELECT '?' AS literal, value FROM t WHERE id = ? -- ?\n AND name = ?"),
    "SELECT '?' AS literal, value FROM t WHERE id = $1 -- ?\n AND name = $2")
  assert.equal(postgresSql('INSERT OR IGNORE INTO t (id) VALUES (?)'),
    'INSERT INTO t (id) VALUES ($1) ON CONFLICT DO NOTHING')
})

test('PostgreSQL metadata initializes, matches SQLite columns, and rolls back writes',
  { skip: !process.env.PG_META_TEST_URL }, async () => {
    const { PostgresMeta, migratePostgres } = await import('../server/postgres-meta.js')
    const schema = `tabletsgo_test_${randomUUID().replaceAll('-', '')}`
    const pg = new PostgresMeta(process.env.PG_META_TEST_URL)
    const sqlite = new Database(':memory:')
    try {
      pg.exec(`CREATE SCHEMA "${schema}"`)
      pg.exec(`SET search_path TO "${schema}"`)
      assert.deepEqual(migratePostgres(pg), { from: 0, applied: [LATEST_VERSION] })
      assert.deepEqual(migratePostgres(pg), { from: LATEST_VERSION, applied: [] })
      migrate(sqlite, { encryptSecret: (x) => x, encryptAppSetting: (x) => x })
      for (const { name } of sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
        const left = sqlite.prepare(`PRAGMA table_info("${name}")`).all().map((r) => r.name).sort()
        const right = pg.prepare('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?')
          .all(name).map((r) => r.column_name).sort()
        assert.deepEqual(right, left, name)
      }
      assert.equal(pg.prepare('SELECT COUNT(*) AS c FROM roles').get().c, 2)
      assert.equal(pg.prepare("SELECT path FROM resource_nodes WHERE id = 'root'").get().path, '/root')
      pg.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)')
        .run('u1', 'person@example.com', 'hash', 'user')
      assert.equal(pg.prepare('INSERT OR IGNORE INTO users (id, username, password_hash) VALUES (?, ?, ?)')
        .run('u2', 'person@example.com', 'hash').changes, 0)
      assert.equal(pg.prepare('SELECT COUNT(*) AS c FROM users').get().c, 1)
      assert.throws(() => pg.transaction(() => {
        pg.prepare('DELETE FROM users WHERE id = ?').run('u1')
        throw new Error('rollback')
      })(), /rollback/)
      assert.equal(pg.prepare('SELECT COUNT(*) AS c FROM users').get().c, 1)
    } finally {
      sqlite.close()
      pg.exec('SET search_path TO public')
      pg.exec(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      pg.close()
    }
    await delay(50)
  })
