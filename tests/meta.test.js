import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'

process.env.ENCRYPTION_KEY = 'meta-test-key'
process.env.META_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tabletsgo-meta-')), 'app.db')
const { runMigrations } = await import('../server/migrator/index.js')
runMigrations({ log: () => {} })
const { db, transaction } = await import('../server/meta.js')

const put = (key, value) =>
  db().app_settings.upsert({ where: { key }, create: { key, value, updated_at: Date.now() }, update: { value } })
const get = async (key) => (await db().app_settings.findUnique({ where: { key } }))?.value

test('BIGINT columns come back as numbers, from models and raw queries alike', async () => {
  await put('n', 'x')
  assert.equal(typeof (await db().app_settings.findUnique({ where: { key: 'n' } })).updated_at, 'number')
  const [{ c }] = await db().$queryRaw`SELECT COUNT(*) AS c FROM app_settings`
  assert.equal(typeof c, 'number')
})

test('a nested transaction joins the outer one, so a rollback undoes both', async () => {
  await assert.rejects(
    transaction(async () => {
      await put('outer', '1')
      await transaction(async () => put('inner', '1'))
      throw new Error('boom')
    }),
    /boom/
  )
  assert.equal(await get('outer'), undefined)
  assert.equal(await get('inner'), undefined)
})

// The SQLite adapter runs everything on one connection, so without the gate in
// meta.js a write from another request would land inside the open transaction
// and vanish with its rollback.
test("another request's write survives a transaction that rolls back around it", async () => {
  const doomed = transaction(async () => {
    await put('doomed', '1')
    await sleep(50)
    throw new Error('rollback')
  }).catch(() => {})
  await sleep(5)
  await Promise.all([doomed, put('bystander', 'kept')])
  assert.equal(await get('bystander'), 'kept')
  assert.equal(await get('doomed'), undefined)
})

test('a committed transaction is visible afterwards', async () => {
  await transaction(async () => put('committed', 'yes'))
  assert.equal(await get('committed'), 'yes')
})
