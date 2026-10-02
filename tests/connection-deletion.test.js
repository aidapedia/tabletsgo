import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

// connections.js imports the production metadata handle. Point it at an
// isolated file and migrate it before anything opens it.
process.env.ENCRYPTION_KEY = 'connection-deletion-test-key'
process.env.META_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tabletsgo-deletion-')), 'app.db')
const { runMigrations } = await import('../server/migrator/index.js')
runMigrations({ log: () => {} })
const { db } = await import('../server/meta.js')
const { CONNECTION_TABLES, deleteConnectionMetadata } = await import('../server/connections.js')

// The least each dependent table needs for a row that belongs to `connectionId`.
const rowFor = (table, connectionId, n) => {
  const id = `${table}-${connectionId}-${n}`
  const base = { id, connection_id: connectionId }
  return {
    saved_queries: { ...base, name: 'q', sql: 'select 1' },
    connection_tables: { ...base, table_name: `t${n}` },
    workflows: { ...base, name: 'w' },
    workflow_runs: { ...base, workflow_id: 'w', trigger_kind: 'manual', status: 'success', started_at: 1, ts: 1 },
    dashboards: { ...base, name: 'd' },
    folders: { ...base, type: 'query', name: 'f' },
    query_history: { ...base, query: 'select 1', status: 'success' },
    connection_access: { ...base, principal_type: 'user', principal_id: 'u' },
    schema_migrations: { ...base, version: 1, forward_sql: '[]', reversible: 1 },
    backup_schedules: { ...base, frequency: 'daily' },
    backup_runs: { ...base, schedule_id: 's', trigger_kind: 'manual', status: 'success', started_at: 1, ts: 1 },
  }[table]
}

let round = 0
async function fixture() {
  round += 1
  const ids = [`deleted-${round}`, `kept-${round}`]
  for (const id of ids) {
    await db().connections.create({ data: { id, data: '{}' } })
    for (const table of CONNECTION_TABLES) await db()[table].create({ data: rowFor(table, id, round) })
  }
  return { deleted: ids[0], kept: ids[1] }
}

const countFor = (table, connectionId) => db()[table].count({ where: { connection_id: connectionId } })

test('connection metadata deletion removes every dependent row and preserves other connections', async () => {
  const { deleted, kept } = await fixture()
  await deleteConnectionMetadata(deleted)
  assert.equal(await db().connections.count({ where: { id: deleted } }), 0)
  assert.equal(await db().connections.count({ where: { id: kept } }), 1)
  for (const table of CONNECTION_TABLES) {
    assert.equal(await countFor(table, deleted), 0, table)
    assert.equal(await countFor(table, kept), 1, table)
  }
})

test('connection metadata deletion rolls back all rows when a dependent delete fails', async () => {
  const { deleted } = await fixture()
  await db().$executeRawUnsafe("CREATE TRIGGER block_backup_delete BEFORE DELETE ON backup_runs BEGIN SELECT RAISE(ABORT, 'blocked'); END")
  try {
    // The driver adapter words a trigger abort as a constraint error; what
    // matters is that it fails, and that nothing below was half-deleted.
    await assert.rejects(deleteConnectionMetadata(deleted))
    assert.equal(await db().connections.count({ where: { id: deleted } }), 1)
    for (const table of CONNECTION_TABLES) assert.equal(await countFor(table, deleted), 1, table)
  } finally {
    await db().$executeRawUnsafe('DROP TRIGGER block_backup_delete')
  }
})
