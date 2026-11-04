import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

process.env.ENCRYPTION_KEY = 'workspace-insights-test-key'
process.env.META_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tabletsgo-insights-')), 'app.db')
const { runMigrations } = await import('../server/migrator/index.js')
runMigrations({ log: () => {} })
const { db } = await import('../server/meta.js')
const { loadPolicy } = await import('../server/permissions.js')
const { createWorkspace, deleteWorkspaceCascade } = await import('../server/workspaces.js')
const { workspaceActivity, workspaceConnections, workspaceMembersDetail, workspaceOverview, workspaceResources } = await import(
  '../server/workspace-insights.js'
)

const SECRET = 'do-not-leak-this-secret'
const NOW = Date.UTC(2026, 10, 4, 12)
const DAY = 24 * 60 * 60 * 1000

let round = 0
async function fixture() {
  round += 1
  const n = round
  await loadPolicy()
  await db().users.create({ data: { id: `owner-${n}`, username: `owner${n}@x.example`, password_hash: SECRET, name: 'Olu', status: 'active', role: 'user' } })
  const workspace = await createWorkspace(`Workspace ${n}`, { ownerId: `owner-${n}` })
  const id = workspace.id
  const connection = `conn-${n}`
  await db().connections.create({
    data: { id: connection, data: '{}', name: 'orders', type: 'postgresql', workspace_id: id, environment: 'production', owner_id: `owner-${n}`, credentials: SECRET, created_at: NOW },
  })
  await db().query_history.createMany({
    data: [
      { id: `q1-${n}`, connection_id: connection, query: SECRET, status: 'success', executor_id: `owner-${n}`, ts: NOW },
      { id: `q2-${n}`, connection_id: connection, query: SECRET, status: 'failed', error: SECRET, executor_id: `owner-${n}`, ts: NOW - DAY },
      { id: `q3-${n}`, connection_id: connection, query: SECRET, status: 'success', ts: NOW - 45 * DAY },
    ],
  })
  await db().backup_schedules.create({ data: { id: `sched-${n}`, connection_id: connection, frequency: 'daily', hour_of_day: 2, destination_ids: `["dest-${n}"]`, enabled: 1 } })
  await db().backup_runs.createMany({
    data: [
      { id: `b1-${n}`, connection_id: connection, schedule_id: `sched-${n}`, trigger_kind: 'schedule', status: 'failed', error: SECRET, started_at: NOW - DAY, ts: NOW },
      { id: `b2-${n}`, connection_id: connection, schedule_id: `sched-${n}`, trigger_kind: 'schedule', status: 'failed', error: SECRET, started_at: NOW - 2 * DAY, ts: NOW },
      { id: `b3-${n}`, connection_id: connection, schedule_id: `sched-${n}`, trigger_kind: 'schedule', status: 'success', started_at: NOW - 3 * DAY, ts: NOW },
    ],
  })
  await db().storage_destinations.create({ data: { id: `dest-${n}`, workspace_id: id, name: 'Backups', bucket: 'b', credentials: SECRET, created_at: NOW } })
  await db().ssh_gateways.create({ data: { id: `gw-${n}`, workspace_id: id, name: 'bastion', host: 'h.example', credentials: SECRET, created_at: NOW } })
  await db().ssh_keys.create({ data: { id: `key-${n}`, workspace_id: id, name: 'deploy', public_key: 'pub', credentials: SECRET, created_at: NOW } })
  return { id, connection }
}

test('the overview adds up, and only counts the last 30 days', async () => {
  const { id } = await fixture()
  const o = await workspaceOverview(id, NOW)
  assert.equal(o.counts.connections, 1)
  assert.equal(o.counts.members, 1)
  assert.equal(o.counts.sshHosts + o.counts.sshKeys, 2)
  assert.deepEqual(o.owners.map((p) => p.name), ['Olu'])
  assert.equal(o.queries.days.length, 30)
  assert.equal(o.queries.total, 2)
  assert.equal(o.queries.failed, 1)
  assert.deepEqual(o.backups, { runs: 3, succeeded: 1 })
  assert.equal(o.attention.failingBackups[0].consecutiveFailures, 2)
  assert.equal(o.attention.failingBackups[0].lastSuccessAt, NOW - 3 * DAY)
})

test('a workspace that does not exist has no overview', async () => {
  assert.equal(await workspaceOverview('missing', NOW), null)
})

test('no answer carries a secret, a query or an error message', async () => {
  const { id } = await fixture()
  const answers = await Promise.all([
    workspaceOverview(id, NOW),
    workspaceMembersDetail(id),
    workspaceConnections(id),
    workspaceResources(id),
    workspaceActivity(id, NOW),
  ])
  assert.ok(!JSON.stringify(answers).includes(SECRET))
})

test('connections resolve who can open them person by person', async () => {
  const { id } = await fixture()
  const [row] = await workspaceConnections(id)
  // The owner, by owning it — the access list itself is empty.
  assert.equal(row.canOpen, 1)
  assert.equal(row.backup.consecutiveFailures, 2)
})

test('activity names the busiest connection and person without their queries', async () => {
  const { id } = await fixture()
  const a = await workspaceActivity(id, NOW)
  assert.deepEqual(a.busiestConnections.map((c) => [c.name, c.queries]), [['orders', 2]])
  assert.deepEqual(a.activeMembers.map((p) => [p.name, p.queries]), [['Olu', 2]])
  assert.equal(a.runs.length, 3)
})

test('deleting a workspace takes its SSH hosts and keys with it', async () => {
  const kept = await fixture()
  const { id } = await fixture()
  await deleteWorkspaceCascade(id)
  assert.equal(await db().ssh_keys.count({ where: { workspace_id: id } }), 0)
  assert.equal(await db().ssh_gateways.count({ where: { workspace_id: id } }), 0)
  assert.equal(await db().ssh_keys.count({ where: { workspace_id: kept.id } }), 1)
  assert.equal(await db().ssh_gateways.count({ where: { workspace_id: kept.id } }), 1)
})
