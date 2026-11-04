/**
 * What an instance admin can see about a workspace they never join.
 *
 * Read-only, and metadata only: what exists, who runs it, and whether it is
 * healthy. Every query names its columns, so a `credentials` blob, a query's
 * text, a run's log or an error message is never loaded in the first place —
 * there is nothing here to strip before answering. Being able to see a
 * connection's name still isn't being able to open it: membership gates that
 * (`userCanAccessConnection`), and an admin holds none.
 */

import { db } from './meta.js'
import { userCanAccessConnection } from './auth.js'
import { filterAsync, safeJson } from './util.js'
import { LOCK_FIELDS, lockStatus } from './login-guard.js'
import { isModuleEnabled } from './module-registry.js'
import { getWorkspaceRow, listWorkspaceMembers } from './workspaces.js'

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_DAYS = 30
const TOP_LIMIT = 5
const RUN_LIMIT = 50
// A streak longer than this reads the same to whoever has to fix it.
const FAILURE_LOOKBACK = 10

const windowStart = (now) => now - (WINDOW_DAYS - 1) * DAY_MS
const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10)

const connectionRows = (workspaceId) =>
  db().connections.findMany({
    where: { workspace_id: workspaceId },
    select: { id: true, name: true, type: true, environment: true, owner_id: true, created_at: true },
    orderBy: { created_at: 'asc' },
  })

const idsOf = (rows) => rows.map((r) => r.id)

const stateOf = (conn) => (isModuleEnabled(conn.type) ? 'active' : 'locked')

// How many rows a per-connection table holds, and across how many connections.
const countByConnection = async (table, connectionIds) => {
  const groups = await db()[table].groupBy({
    by: ['connection_id'],
    where: { connection_id: { in: connectionIds } },
    _count: { _all: true },
  })
  return {
    total: groups.reduce((sum, g) => sum + Number(g._count._all), 0),
    connections: groups.length,
  }
}

// From the newest run back: how many in a row failed, and when one last worked.
const backupHealth = async (connectionId) => {
  const runs = await db().backup_runs.findMany({
    where: { connection_id: connectionId },
    select: { status: true, started_at: true },
    orderBy: { started_at: 'desc' },
    take: FAILURE_LOOKBACK,
  })
  const firstGood = runs.findIndex((r) => r.status !== 'failed')
  return {
    consecutiveFailures: firstGood === -1 ? runs.length : firstGood,
    lastSuccessAt: firstGood === -1 ? null : runs[firstGood].started_at,
  }
}

const backupSchedules = (connectionIds) =>
  db().backup_schedules.findMany({
    where: { connection_id: { in: connectionIds }, enabled: 1 },
    select: { connection_id: true, frequency: true, hour_of_day: true, destination_ids: true },
  })

const lastActivityAt = async (connectionIds) => {
  const where = { connection_id: { in: connectionIds } }
  const [queries, backups, workflows] = await Promise.all([
    db().query_history.aggregate({ where, _max: { ts: true } }),
    db().backup_runs.aggregate({ where, _max: { started_at: true } }),
    db().workflow_runs.aggregate({ where, _max: { started_at: true } }),
  ])
  const latest = Math.max(queries._max.ts || 0, backups._max.started_at || 0, workflows._max.started_at || 0)
  return latest ? Number(latest) : null
}

const queriesPerDay = async (connectionIds, now) => {
  const rows = await db().query_history.findMany({
    where: { connection_id: { in: connectionIds }, ts: { gte: windowStart(now) } },
    select: { ts: true, status: true },
  })
  const days = new Map()
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    days.set(dayOf(now - i * DAY_MS), { day: dayOf(now - i * DAY_MS), total: 0, failed: 0 })
  }
  for (const row of rows) {
    const bucket = days.get(dayOf(Number(row.ts)))
    if (!bucket) continue
    bucket.total += 1
    if (row.status === 'failed') bucket.failed += 1
  }
  const list = [...days.values()]
  return {
    days: list,
    total: list.reduce((sum, d) => sum + d.total, 0),
    failed: list.reduce((sum, d) => sum + d.failed, 0),
  }
}

const tally = (rows, keyOf) => {
  const counts = new Map()
  for (const row of rows) counts.set(keyOf(row), (counts.get(keyOf(row)) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

/**
 * The header and Overview tab. `Settings` reads `counts` too: it is exactly what
 * deleting the workspace takes with it.
 */
export const workspaceOverview = async (workspaceId, now = Date.now()) => {
  const workspace = await getWorkspaceRow(workspaceId)
  if (!workspace) return null
  const settings = safeJson(workspace.settings) || {}
  const [members, connections] = await Promise.all([listWorkspaceMembers(workspaceId), connectionRows(workspaceId)])
  const ids = idsOf(connections)
  const where = { connection_id: { in: ids } }
  const [dashboards, workflows, scheduledWorkflows, savedQueries, schemaDrafts, groups, storage, sshHosts, sshKeys] =
    await Promise.all([
      db().dashboards.count({ where }),
      db().workflows.count({ where }),
      db().workflows.count({ where: { ...where, schedule_enabled: 1 } }),
      db().saved_queries.count({ where }),
      db().schema_drafts.count({ where: { workspace_id: workspaceId } }),
      db().resource_nodes.count({ where: { workspace_id: workspaceId, type: 'group' } }),
      db().storage_destinations.count({ where: { workspace_id: workspaceId } }),
      db().ssh_gateways.count({ where: { workspace_id: workspaceId } }),
      db().ssh_keys.count({ where: { workspace_id: workspaceId } }),
    ])

  const [queries, backupsRun, backupsSucceeded, activityAt, schedules] = await Promise.all([
    queriesPerDay(ids, now),
    db().backup_runs.count({ where: { ...where, started_at: { gte: windowStart(now) } } }),
    db().backup_runs.count({ where: { ...where, started_at: { gte: windowStart(now) }, status: 'success' } }),
    lastActivityAt(ids),
    backupSchedules(ids),
  ])

  const nameOf = new Map(connections.map((c) => [c.id, c.name]))
  const failingBackups = (
    await Promise.all(
      schedules.map(async (s) => ({
        connectionId: s.connection_id,
        name: nameOf.get(s.connection_id),
        ...(await backupHealth(s.connection_id)),
      }))
    )
  ).filter((b) => b.consecutiveFailures > 0)

  const locked = connections.filter((c) => stateOf(c) === 'locked')
  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      createdAt: workspace.created_at,
      lastActivityAt: activityAt,
      maxSessionsPerConnection: settings.sessions?.maxPerConnection ?? 0,
      backupFailureAlerts: !!settings.notifications?.backupFailure?.enabled,
    },
    owners: members.filter((m) => m.isOwner).map(({ userId, name, email }) => ({ userId, name, email })),
    counts: {
      members: members.length,
      pendingMembers: members.filter((m) => m.status === 'pending').length,
      connections: connections.length,
      lockedConnections: locked.length,
      groups,
      dashboards,
      workflows,
      scheduledWorkflows,
      savedQueries,
      schemaDrafts,
      storageDestinations: storage,
      sshHosts,
      sshKeys,
    },
    queries,
    backups: { runs: backupsRun, succeeded: backupsSucceeded },
    engines: tally(connections, (c) => c.type).map(([type, count]) => ({
      type,
      count,
      locked: locked.some((c) => c.type === type),
    })),
    environments: tally(connections, (c) => c.environment || 'unset').map(([environment, count]) => ({ environment, count })),
    attention: { lockedConnections: locked.map((c) => c.name), failingBackups },
  }
}

/** The roster, plus what an admin needs beside it: how they sign in, their groups, a block. */
export const workspaceMembersDetail = async (workspaceId) => {
  const members = await listWorkspaceMembers(workspaceId)
  const ids = members.map((m) => m.userId)
  const groupIds = idsOf(
    await db().resource_nodes.findMany({ where: { workspace_id: workspaceId, type: 'group' }, select: { id: true } })
  )
  const [users, identities, rosters] = await Promise.all([
    db().users.findMany({ where: { id: { in: ids } }, select: { id: true, password_hash: true, ...LOCK_FIELDS } }),
    db().user_identities.findMany({ where: { user_id: { in: ids } }, select: { user_id: true, provider: true } }),
    db().node_members.findMany({ where: { node_id: { in: groupIds } }, select: { user_id: true } }),
  ])
  const userById = new Map(users.map((u) => [u.id, u]))
  return members.map((m) => {
    const user = userById.get(m.userId)
    return {
      ...m,
      blocked: !!user && lockStatus(user).blocked,
      signIn: [
        ...(user?.password_hash ? ['password'] : []),
        ...identities.filter((i) => i.user_id === m.userId).map((i) => i.provider),
      ],
      groupCount: rosters.filter((r) => r.user_id === m.userId).length,
    }
  })
}

export const workspaceConnections = async (workspaceId) => {
  const connections = await connectionRows(workspaceId)
  const ownerIds = connections.map((c) => c.owner_id).filter(Boolean)
  const [members, owners, schedules] = await Promise.all([
    listWorkspaceMembers(workspaceId),
    db().users.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, username: true } }),
    backupSchedules(idsOf(connections)),
  ])
  const ownerById = new Map(owners.map((u) => [u.id, u]))
  return Promise.all(
    connections.map(async (c) => {
      const owner = ownerById.get(c.owner_id)
      const schedule = schedules.find((s) => s.connection_id === c.id)
      // Resolved person by person: being on a list and being able to open it are
      // different questions, and a connection's own list misses group rosters.
      const conn = { id: c.id, workspaceId, ownerId: c.owner_id || undefined }
      const canOpen = await filterAsync(members, (m) => userCanAccessConnection(conn, m.userId))
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        environment: c.environment || null,
        state: stateOf(c),
        ownerName: owner ? owner.name || owner.username : null,
        canOpen: canOpen.length,
        backup: schedule
          ? {
              frequency: schedule.frequency,
              hourOfDay: schedule.hour_of_day ?? 0,
              consecutiveFailures: (await backupHealth(c.id)).consecutiveFailures,
            }
          : null,
        createdAt: c.created_at,
      }
    })
  )
}

export const workspaceResources = async (workspaceId) => {
  const connections = await connectionRows(workspaceId)
  const ids = idsOf(connections)
  const [dashboards, workflows, savedQueries, scheduledWorkflows, schemaDrafts, groups, storage, hosts, keys, schedules] =
    await Promise.all([
      countByConnection('dashboards', ids),
      countByConnection('workflows', ids),
      countByConnection('saved_queries', ids),
      db().workflows.count({ where: { connection_id: { in: ids }, schedule_enabled: 1 } }),
      db().schema_drafts.count({ where: { workspace_id: workspaceId } }),
      db().resource_nodes.findMany({
        where: { workspace_id: workspaceId, type: 'group' },
        select: { id: true, name: true, path: true },
        orderBy: { name: 'asc' },
      }),
      db().storage_destinations.findMany({
        where: { workspace_id: workspaceId },
        select: { id: true, name: true, bucket: true, region: true },
        orderBy: { created_at: 'asc' },
      }),
      db().ssh_gateways.findMany({
        where: { workspace_id: workspaceId },
        select: { id: true, name: true, host: true, port: true, transport: true, host_fingerprint: true },
        orderBy: { created_at: 'asc' },
      }),
      db().ssh_keys.findMany({
        where: { workspace_id: workspaceId },
        select: { id: true, name: true, algorithm: true, fingerprint: true },
        orderBy: { created_at: 'asc' },
      }),
      db().backup_schedules.findMany({ where: { connection_id: { in: ids } }, select: { destination_ids: true } }),
    ])

  const groupRows = await Promise.all(
    groups.map(async (g) => {
      const [people, filed] = await Promise.all([
        db().node_members.count({ where: { node_id: g.id } }),
        db().resource_nodes.count({ where: { type: 'connection', path: { startsWith: `${g.path}/` } } }),
      ])
      return { id: g.id, name: g.name, people, connections: filed }
    })
  )

  const destinationIds = schedules.flatMap((s) => safeJson(s.destination_ids) || [])
  return {
    totals: { dashboards, workflows, savedQueries, scheduledWorkflows, schemaDrafts },
    groups: groupRows,
    storage: storage.map((s) => ({
      id: s.id,
      name: s.name,
      bucket: s.bucket,
      region: s.region || null,
      schedules: destinationIds.filter((id) => id === s.id).length,
    })),
    sshHosts: hosts.map((h) => ({
      id: h.id,
      name: h.name,
      host: h.host,
      port: h.port || 22,
      transport: h.transport === 'cloudflare' ? 'cloudflare' : 'tcp',
      hostKeyPinned: !!h.host_fingerprint,
    })),
    sshKeys: keys.map((k) => ({ id: k.id, name: k.name, algorithm: k.algorithm || null, fingerprint: k.fingerprint || null })),
  }
}

// Counts per connection and per person: who and what is busy, never what they ran.
const busiest = async (connectionIds, now) => {
  const where = { connection_id: { in: connectionIds }, ts: { gte: windowStart(now) } }
  const [byConnection, byPerson] = await Promise.all([
    db().query_history.groupBy({ by: ['connection_id'], where, _count: { _all: true } }),
    db().query_history.groupBy({ by: ['executor_id'], where: { ...where, executor_id: { not: null } }, _count: { _all: true } }),
  ])
  const top = (groups) =>
    groups
      .map((g) => ({ ...g, queries: Number(g._count._all) }))
      .sort((a, b) => b.queries - a.queries)
      .slice(0, TOP_LIMIT)
  return { connections: top(byConnection), people: top(byPerson) }
}

export const workspaceActivity = async (workspaceId, now = Date.now()) => {
  const connections = await connectionRows(workspaceId)
  const ids = idsOf(connections)
  const nameOf = new Map(connections.map((c) => [c.id, c.name]))
  const where = { connection_id: { in: ids } }
  const select = { id: true, connection_id: true, trigger_kind: true, status: true, started_at: true, finished_at: true }
  const take = RUN_LIMIT
  const orderBy = { started_at: 'desc' }
  const [top, backups, workflowRuns] = await Promise.all([
    busiest(ids, now),
    db().backup_runs.findMany({ where, select, orderBy, take }),
    db().workflow_runs.findMany({ where, select: { ...select, workflow_id: true }, orderBy, take }),
  ])
  const [people, workflows] = await Promise.all([
    db().users.findMany({ where: { id: { in: top.people.map((p) => p.executor_id) } }, select: { id: true, name: true, username: true } }),
    db().workflows.findMany({ where: { id: { in: workflowRuns.map((r) => r.workflow_id) } }, select: { id: true, name: true } }),
  ])
  const run = (r, kind, name) => ({
    id: r.id,
    kind,
    name,
    connectionId: r.connection_id,
    connectionName: nameOf.get(r.connection_id) || null,
    trigger: r.trigger_kind,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? null,
  })
  return {
    busiestConnections: top.connections.map((c) => ({ id: c.connection_id, name: nameOf.get(c.connection_id), queries: c.queries })),
    activeMembers: top.people.map((p) => {
      const user = people.find((u) => u.id === p.executor_id)
      return { id: p.executor_id, name: user ? user.name || user.username : 'Former member', queries: p.queries }
    }),
    runs: [
      ...backups.map((r) => run(r, 'backup', null)),
      ...workflowRuns.map((r) => run(r, 'workflow', workflows.find((w) => w.id === r.workflow_id)?.name || 'Deleted workflow')),
    ]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, RUN_LIMIT),
  }
}
