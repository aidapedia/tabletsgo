import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

// The instance's module switches: what an admin may turn off, and how settings
// resolve against the environment.

process.env.ENCRYPTION_KEY = 'module-settings-test-key'
process.env.META_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tabletsgo-modules-')), 'app.db')
const { runMigrations } = await import('../server/migrator/index.js')
runMigrations({ log: () => {} })
const { saveConnection, deleteConnectionMetadata } = await import('../server/connections.js')
const { adminModules, loadModules, publicModules, updateModules } = await import('../server/module-settings.js')
const { assertModuleEnabled, isModuleEnabled, moduleSetting, optionalModuleSetting } = await import('../server/module-registry.js')
const db = await import('../server/db/index.js')
const { groupByRecipient, notifyModuleOwners } = await import('../server/module-notices.js')

test('owners are notified once per unique address, with all of their connections', () => {
  const groups = groupByRecipient([
    { name: 'orders-events', ownerName: 'Rina', ownerEmail: 'rina@acme.com' },
    { name: 'payments-cdc', ownerName: 'Rina', ownerEmail: ' Rina@Acme.com ' },
    { name: 'clickstream', ownerName: 'Dimas', ownerEmail: 'dimas@acme.com' },
    { name: 'orphan', ownerName: null, ownerEmail: null },
  ])
  assert.deepEqual(
    groups.map((g) => [g.email, g.connections.map((c) => c.name)]),
    [
      ['rina@acme.com', ['orders-events', 'payments-cdc']],
      ['dimas@acme.com', ['clickstream']],
    ]
  )
})

await loadModules()

test('with nothing stored, every module is on — an upgrade hides nothing', () => {
  assert.ok(publicModules().filter((m) => m.id !== 'registration').every((m) => m.enabled))
})

test('registration alone starts off, so an upgrade never opens sign-ups', async () => {
  assert.equal(isModuleEnabled('registration'), false)
  await updateModules({ registration: { enabled: true } })
  assert.equal(isModuleEnabled('registration'), true)
  await updateModules({ registration: { enabled: false } })
  assert.equal(isModuleEnabled('registration'), false)
})

test('an engine nobody uses turns off, and the db layer then refuses it', async () => {
  await updateModules({ redis: { enabled: false } })
  assert.equal(isModuleEnabled('redis'), false)
  assert.throws(() => db.driverFor({ type: 'redis' }), (e) => e.status === 403 && /Redis is turned off/.test(e.message))
  assert.throws(() => assertModuleEnabled('redis'), (e) => e.status === 403)
  // Letting go of handles never asks.
  assert.doesNotThrow(() => db.releaseConnection({ type: 'redis' }))

  await updateModules({ redis: { enabled: true } })
  assert.ok(db.driverFor({ type: 'redis' }))
})

test('forced off, an engine in use keeps its connections; the notice needs a mail server', async () => {
  await saveConnection({ id: 'k2', type: 'kafka', name: 'audit-log', workspaceId: null, brokers: 'localhost:9092' })
  await updateModules({ kafka: { enabled: false } }, { force: true })
  assert.equal(isModuleEnabled('kafka'), false)
  // Locked, not deleted: the connection is still there and still counted.
  const kafka = (await adminModules()).find((m) => m.id === 'kafka')
  assert.equal(kafka.usage.connections, 1)
  assert.throws(() => db.driverFor({ type: 'kafka' }), (e) => e.status === 403)

  // No SMTP in this test instance — the notice says so instead of pretending.
  await assert.rejects(notifyModuleOwners('kafka'), /No connection on Kafka has an owner|No mail server/)

  await updateModules({ kafka: { enabled: true } })
  await deleteConnectionMetadata('k2')
})

test('an engine with connections isn’t turned off without force, and the refusal names them', async () => {
  await saveConnection({ id: 'k1', type: 'kafka', name: 'orders-events', workspaceId: null, brokers: 'localhost:9092' })
  await assert.rejects(updateModules({ kafka: { enabled: false } }), (e) => {
    assert.equal(e.status, 409)
    assert.equal(e.module, 'kafka')
    assert.deepEqual(e.connections.map((c) => c.name), ['orders-events'])
    return true
  })
  assert.equal(isModuleEnabled('kafka'), true)
  const kafka = (await adminModules()).find((m) => m.id === 'kafka')
  assert.equal(kafka.usage.connections, 1)

  await deleteConnectionMetadata('k1')
  await updateModules({ kafka: { enabled: false } })
  assert.equal(isModuleEnabled('kafka'), false)
  await updateModules({ kafka: { enabled: true } })
})

test('the last database can’t be turned off', async () => {
  await assert.rejects(
    updateModules({ postgresql: { enabled: false }, mysql: { enabled: false }, sqlite: { enabled: false }, redis: { enabled: false }, kafka: { enabled: false } }),
    /at least one database/
  )
  assert.ok(['postgresql', 'mysql', 'sqlite', 'redis', 'kafka'].every(isModuleEnabled))
})

test('a feature turns off without a connection check', async () => {
  await updateModules({ backup: { enabled: false } })
  assert.throws(() => assertModuleEnabled('backup'), /Backup is turned off/)
  await updateModules({ backup: { enabled: true } })
})

test('settings validate, survive a reload, and reset with null', async () => {
  await assert.rejects(updateModules({ kafka: { settings: { readMaxMessages: 0 } } }), /whole number from 1/)
  await assert.rejects(updateModules({ kafka: { settings: { nope: 1 } } }), /no setting "nope"/)
  await assert.rejects(updateModules({ nope: { enabled: true } }), /Unknown module/)

  await updateModules({ kafka: { settings: { readMaxMessages: '750' } } })
  assert.equal(moduleSetting('kafka', 'readMaxMessages'), 750)
  await loadModules()
  assert.equal(moduleSetting('kafka', 'readMaxMessages'), 750)

  await updateModules({ kafka: { settings: { readMaxMessages: null } } })
  assert.equal(moduleSetting('kafka', 'readMaxMessages'), 500)
})

test('Kafka’s read caps default to 500 messages / 16 MiB / 8 s and are the admin’s to change', async () => {
  assert.equal(moduleSetting('kafka', 'readMaxMessages'), 500)
  assert.equal(moduleSetting('kafka', 'readMaxBytes'), 16 * 1024 * 1024)
  assert.equal(moduleSetting('kafka', 'readTimeoutMs'), 8000)
  await updateModules({ kafka: { settings: { readTimeoutMs: 20000 } } })
  assert.equal(moduleSetting('kafka', 'readTimeoutMs'), 20000)
  await updateModules({ kafka: { settings: { readTimeoutMs: null } } })
  assert.equal(moduleSetting('kafka', 'readTimeoutMs'), 8000)
})

test('each engine has its own query timeout; only engines with tables have a row limit', async () => {
  assert.equal(moduleSetting('postgresql', 'queryTimeoutSec'), 30)
  assert.equal(moduleSetting('postgresql', 'tableRowLimit'), 50000)
  assert.equal(optionalModuleSetting('redis', 'tableRowLimit'), undefined)
  assert.equal(optionalModuleSetting('kafka', 'tableRowLimit'), undefined)

  await updateModules({ postgresql: { settings: { queryTimeoutSec: 120, tableRowLimit: 1000 } } })
  assert.equal(moduleSetting('postgresql', 'queryTimeoutSec'), 120)
  assert.equal(moduleSetting('sqlite', 'queryTimeoutSec'), 30) // per engine, not shared
  await assert.rejects(updateModules({ redis: { settings: { tableRowLimit: 10 } } }), /no setting "tableRowLimit"/)

  // Signed-in clients read the values in effect.
  const pg = publicModules().find((m) => m.id === 'postgresql')
  assert.deepEqual(pg.settings, { tableRowLimit: 1000, queryTimeoutSec: 120 })

  await updateModules({ postgresql: { settings: { queryTimeoutSec: null, tableRowLimit: null } } })
})

test('a turned-off engine drops out of the schema designer’s engines', async () => {
  await updateModules({ sqlite: { enabled: false } })
  assert.ok(!db.designableEngines().some((e) => e.type === 'sqlite'))
  await updateModules({ sqlite: { enabled: true } })
  assert.ok(db.designableEngines().some((e) => e.type === 'sqlite'))
})
