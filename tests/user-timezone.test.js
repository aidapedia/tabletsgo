import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

process.env.ENCRYPTION_KEY = 'user-timezone-test-key'
process.env.META_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tabletsgo-timezone-')), 'app.db')
const { runMigrations } = await import('../server/migrator/index.js')
runMigrations({ log: () => {} })
const { db } = await import('../server/meta.js')
const { publicUser, userRow } = await import('../server/auth.js')
const { updateUser } = await import('../server/users.js')
const { isTimeZone } = await import('../server/util.js')

// The frontend helper is TypeScript; strip it so these tests can run it as is.
const source = fs.readFileSync(new URL('../console/src/shared/lib/datetime.ts', import.meta.url), 'utf8')
const datetime = await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`)

const atZone = (zone, fn) => {
  datetime.setDisplayTimeZone(zone)
  try {
    return fn()
  } finally {
    datetime.setDisplayTimeZone(null)
  }
}

test('a chosen zone is saved, comes back on the session user, and can be cleared', async () => {
  await db().users.create({ data: { id: 'u1', username: 'u1@x.example', password_hash: 'x', name: 'U', status: 'active', role: 'user' } })
  assert.equal(publicUser(await userRow('u1')).timezone, null)
  await updateUser('u1', { timezone: 'Asia/Jakarta' })
  assert.equal(publicUser(await userRow('u1')).timezone, 'Asia/Jakarta')
  await updateUser('u1', { name: 'Renamed' })
  assert.equal(publicUser(await userRow('u1')).timezone, 'Asia/Jakarta')
  await updateUser('u1', { timezone: null })
  assert.equal(publicUser(await userRow('u1')).timezone, null)
})

test('only zones the runtime can format are accepted', () => {
  assert.ok(isTimeZone('Asia/Jakarta'))
  assert.ok(isTimeZone('UTC'))
  for (const bad of ['Mars/Olympus', '', null, 7, {}]) assert.equal(isTimeZone(bad), false)
})

test('the same instant renders in the chosen zone', () => {
  const instant = Date.UTC(2026, 10, 4, 18, 30)
  const options = { hour: '2-digit', minute: '2-digit', hour12: false }
  assert.match(atZone('Asia/Jakarta', () => datetime.formatTime(instant, options)), /01:30/)
  assert.match(atZone('America/New_York', () => datetime.formatTime(instant, options)), /13:30/)
})

test('two instants are the same day only in the chosen zone', () => {
  const late = Date.UTC(2026, 10, 4, 16, 0)
  const later = Date.UTC(2026, 10, 4, 18, 0)
  assert.equal(atZone('UTC', () => datetime.isSameDay(late, later)), true)
  // 23:00 on the 4th and 01:00 on the 5th.
  assert.equal(atZone('Asia/Jakarta', () => datetime.isSameDay(late, later)), false)
})

test('a time typed into an input means that time in the chosen zone', () => {
  const instant = (zone, value) => atZone(zone, () => datetime.zonedInputToDate(value).toISOString())
  assert.equal(instant('Asia/Jakarta', '2026-11-04T09:30'), '2026-11-04T02:30:00.000Z')
  assert.equal(instant('UTC', '2026-11-04T09:30:15'), '2026-11-04T09:30:15.000Z')
  // Either side of a daylight-saving change, where the offset differs.
  assert.equal(instant('America/New_York', '2026-07-01T12:00'), '2026-07-01T16:00:00.000Z')
  assert.equal(instant('America/New_York', '2026-12-01T12:00'), '2026-12-01T17:00:00.000Z')
  assert.equal(instant('America/New_York', '2026-11-01T00:30'), '2026-11-01T04:30:00.000Z')
  assert.equal(instant('America/New_York', '2026-11-01T03:00'), '2026-11-01T08:00:00.000Z')
})

test('a zone this browser cannot format falls back instead of throwing', () => {
  datetime.setDisplayTimeZone('Mars/Olympus')
  assert.equal(datetime.displayTimeZone(), Intl.DateTimeFormat().resolvedOptions().timeZone)
  assert.doesNotThrow(() => datetime.formatDateTime(0))
  datetime.setDisplayTimeZone(null)
})
