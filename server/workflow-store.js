/** Saved workflows and their run history in the app metadata store. Execution
 * and scheduling live in workflow.js; both use the same workflow rows. */

import { randomUUID } from 'crypto'
import { db } from './meta.js'
import { safeJson } from './util.js'
import { nextRunForGraph } from './workflow.js'

const invalid = (message) => Object.assign(new Error(message), { status: 400 })

export async function listConnectionWorkflows(connectionId) {
  return (
    await db().workflows.findMany({
      where: { connection_id: connectionId },
      select: { id: true, name: true, ts: true, protected: true, schedule_enabled: true, folder_id: true },
      orderBy: { ts: 'desc' },
    })
  ).map((row) => ({
      id: row.id,
      name: row.name,
      ts: row.ts,
      protected: !!row.protected,
      scheduleEnabled: !!row.schedule_enabled,
      folderId: row.folder_id || null,
    }))
}

export async function createWorkflow(connectionId, body = {}) {
  if (typeof body.name !== 'string' || !body.name.trim()) throw invalid('A workflow name is required')
  const entry = {
    id: randomUUID(),
    name: body.name.trim(),
    graph: body.graph && typeof body.graph === 'object' ? body.graph : { nodes: [], edges: [] },
    folderId: body.folderId || null,
    ts: Date.now(),
  }
  await db().workflows.create({
    data: { id: entry.id, connection_id: connectionId, name: entry.name, graph: JSON.stringify(entry.graph), folder_id: entry.folderId, ts: entry.ts },
  })
  return { ...entry, protected: false, scheduleEnabled: false }
}

export async function getWorkflow(connectionId, workflowId) {
  const row = await db().workflows.findFirst({
    where: { id: workflowId, connection_id: connectionId },
    select: { id: true, name: true, graph: true, protected: true, schedule_enabled: true },
  })
  return row && {
    id: row.id,
    name: row.name,
    graph: safeJson(row.graph),
    protected: !!row.protected,
    scheduleEnabled: !!row.schedule_enabled,
  }
}

export async function getWebhookWorkflow(workflowId) {
  const row = workflowId
    ? await db().workflows.findUnique({ where: { id: workflowId }, select: { id: true, connection_id: true, graph: true } })
    : null
  return row && { id: row.id, connectionId: row.connection_id, graph: safeJson(row.graph) }
}

export async function updateWorkflow(connectionId, workflowId, body = {}) {
  const existing = await db().workflows.findFirst({
    where: { id: workflowId, connection_id: connectionId },
    select: { graph: true, schedule_enabled: true },
  })
  if (!existing) return false
  const data = {}
  if (body.name != null) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw invalid('A name is required')
    data.name = body.name.trim()
  }
  if (body.graph != null) data.graph = JSON.stringify(body.graph)
  if (body.scheduleEnabled != null) data.schedule_enabled = body.scheduleEnabled ? 1 : 0
  if ('folderId' in body) data.folder_id = body.folderId || null
  if (!Object.keys(data).length) throw invalid('Nothing to update')
  if (body.graph != null || body.scheduleEnabled != null) {
    const graph = body.graph != null ? body.graph : safeJson(existing.graph)
    const enabled = body.scheduleEnabled != null ? !!body.scheduleEnabled : !!existing.schedule_enabled
    data.next_run_at = nextRunForGraph(graph, enabled)
  }
  return (await db().workflows.updateMany({ where: { id: workflowId, connection_id: connectionId }, data })).count > 0
}

export async function deleteWorkflow(connectionId, workflowId) {
  const row = await db().workflows.findFirst({ where: { id: workflowId, connection_id: connectionId }, select: { protected: true } })
  if (!row) return 'missing'
  if (row.protected) return 'protected'
  await db().workflows.deleteMany({ where: { id: workflowId, connection_id: connectionId } })
  return 'deleted'
}

export async function listWorkflowRuns(connectionId, workflowId, { limit = 50, offset = 0 } = {}) {
  const workflow = await db().workflows.findFirst({ where: { id: workflowId, connection_id: connectionId }, select: { id: true } })
  if (!workflow) return null
  return (
    await db().workflow_runs.findMany({
      where: { workflow_id: workflowId },
      select: { id: true, trigger_kind: true, status: true, error: true, started_at: true, finished_at: true },
      orderBy: { started_at: 'desc' },
      take: limit,
      skip: offset,
    })
  ).map((row) => ({
    id: row.id,
    triggerKind: row.trigger_kind,
    status: row.status,
    error: row.error || null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    ms: row.finished_at && row.started_at ? row.finished_at - row.started_at : null,
  }))
}

export async function getWorkflowRun(connectionId, workflowId, runId) {
  const row = await db().workflow_runs.findFirst({
    where: { id: runId, workflow_id: workflowId, connection_id: connectionId },
    select: { id: true, trigger_kind: true, status: true, log: true, error: true, started_at: true, finished_at: true },
  })
  return row && {
    id: row.id,
    triggerKind: row.trigger_kind,
    status: row.status,
    ok: row.status === 'success',
    log: safeJson(row.log) || [],
    error: row.error || null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    ms: row.finished_at && row.started_at ? row.finished_at - row.started_at : null,
  }
}
