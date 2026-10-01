import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'

// connections.js imports the production metadata handle. Point it at an
// isolated file before importing; the cascade itself receives an in-memory DB.
process.env.ENCRYPTION_KEY = 'connection-deletion-test-key'
process.env.META_DB = ':memory:'
const { deleteConnectionMetadata } = await import('../server/connections.js')

const dependentTables = [
  'saved_queries', 'connection_tables', 'workflows', 'workflow_runs',
  'dashboards', 'folders', 'query_history', 'connection_access',
  'schema_migrations', 'backup_schedules', 'backup_runs',
]

function fixture() {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE connections (id TEXT PRIMARY KEY)')
  db.prepare('INSERT INTO connections (id) VALUES (?)').run('deleted')
  db.prepare('INSERT INTO connections (id) VALUES (?)').run('kept')
  for (const table of dependentTables) {
    db.exec(`CREATE TABLE ${table} (connection_id TEXT NOT NULL)`)
    const insert = db.prepare(`INSERT INTO ${table} (connection_id) VALUES (?)`)
    insert.run('deleted')
    insert.run('kept')
  }
  return db
}

test('connection metadata deletion removes every dependent row and preserves other connections', () => {
  const db = fixture()
  try {
    deleteConnectionMetadata('deleted', db)
    assert.deepEqual(db.prepare('SELECT id FROM connections').all(), [{ id: 'kept' }])
    for (const table of dependentTables) {
      assert.deepEqual(db.prepare(`SELECT connection_id FROM ${table}`).all(), [{ connection_id: 'kept' }], table)
    }
  } finally {
    db.close()
  }
})

test('connection metadata deletion rolls back all rows when a dependent delete fails', () => {
  const db = fixture()
  try {
    db.exec("CREATE TRIGGER block_backup_delete BEFORE DELETE ON backup_runs BEGIN SELECT RAISE(ABORT, 'blocked'); END")
    assert.throws(() => deleteConnectionMetadata('deleted', db), /blocked/)
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM connections WHERE id = 'deleted'").get().count, 1)
    for (const table of dependentTables) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE connection_id = 'deleted'`).get().count, 1, table)
    }
  } finally {
    db.close()
  }
})
