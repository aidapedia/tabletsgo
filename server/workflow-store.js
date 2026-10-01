/** Saved workflows and their run history in the app metadata store. Execution
 * and scheduling live in workflow.js; both use the same workflow rows. */

import { randomUUID } from 'crypto'
import { meta } from './meta.js'
import { safeJson } from './util.js'
import { nextRunForGraph } from './workflow.js'

const invalid = (message) => Object.assign(new Error(message), { status: 400 })

export function listConnectionWorkflows(connectionId) {
  return meta.prepare('SELECT id, name, ts, protected, schedule_enabled, folder_id FROM workflows WHERE connection_id = ? ORDER BY ts DESC')
    .all(connectionId)
    .map((row) => ({
      id: row.id,
      name: row.name,
      ts: row.ts,
      protected: !!row.protected,
      scheduleEnabled: !!row.schedule_enabled,
      folderId: row.folder_id || null,
    }))
}

export function createWorkflow(connectionId, body = {}) {
  if (typeof body.name !== 'string' || !body.name.trim()) throw invalid('A workflow name is required')
  const entry = {
    id: randomUUID(),
    name: body.name.trim(),
    graph: body.graph && typeof body.graph === 'object' ? body.graph : { nodes: [], edges: [] },
    folderId: body.folderId || null,
    ts: Date.now(),
  }
  meta.prepare('INSERT INTO workflows (id, connection_id, name, graph, folder_id, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .run(entry.id, connectionId, entry.name, JSON.stringify(entry.graph), entry.folderId, entry.ts)
  return { ...entry, protected: false, scheduleEnabled: false }
}

export function getWorkflow(connectionId, workflowId) {
  const row = meta.prepare('SELECT id, name, graph, protected, schedule_enabled FROM workflows WHERE id = ? AND connection_id = ?')
    .get(workflowId, connectionId)
  return row && {
    id: row.id,
    name: row.name,
    graph: safeJson(row.graph),
    protected: !!row.protected,
    scheduleEnabled: !!row.schedule_enabled,
  }
}

export function getWebhookWorkflow(workflowId) {
  const row = meta.prepare('SELECT id, connection_id, graph FROM workflows WHERE id = ?').get(workflowId)
  return row && { id: row.id, connectionId: row.connection_id, graph: safeJson(row.graph) }
}

export function updateWorkflow(connectionId, workflowId, body = {}) {
  const existing = meta.prepare('SELECT graph, schedule_enabled FROM workflows WHERE id = ? AND connection_id = ?')
    .get(workflowId, connectionId)
  if (!existing) return false
  const sets = []
  const vals = []
  if (body.name != null) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw invalid('A name is required')
    sets.push('name = ?')
    vals.push(body.name.trim())
  }
  if (body.graph != null) {
    sets.push('graph = ?')
    vals.push(JSON.stringify(body.graph))
  }
  if (body.scheduleEnabled != null) {
    sets.push('schedule_enabled = ?')
    vals.push(body.scheduleEnabled ? 1 : 0)
  }
  if ('folderId' in body) {
    sets.push('folder_id = ?')
    vals.push(body.folderId || null)
  }
  if (!sets.length) throw invalid('Nothing to update')
  if (body.graph != null || body.scheduleEnabled != null) {
    const graph = body.graph != null ? body.graph : safeJson(existing.graph)
    const enabled = body.scheduleEnabled != null ? !!body.scheduleEnabled : !!existing.schedule_enabled
    sets.push('next_run_at = ?')
    vals.push(nextRunForGraph(graph, enabled))
  }
  return !!meta.prepare(`UPDATE workflows SET ${sets.join(', ')} WHERE id = ? AND connection_id = ?`)
    .run(...vals, workflowId, connectionId).changes
}

export function deleteWorkflow(connectionId, workflowId) {
  const row = meta.prepare('SELECT protected FROM workflows WHERE id = ? AND connection_id = ?').get(workflowId, connectionId)
  if (!row) return 'missing'
  if (row.protected) return 'protected'
  meta.prepare('DELETE FROM workflows WHERE id = ? AND connection_id = ?').run(workflowId, connectionId)
  return 'deleted'
}

export function listWorkflowRuns(connectionId, workflowId, { limit = 50, offset = 0 } = {}) {
  const workflow = meta.prepare('SELECT 1 FROM workflows WHERE id = ? AND connection_id = ?').get(workflowId, connectionId)
  if (!workflow) return null
  return meta.prepare(
    `SELECT id, trigger_kind, status, error, started_at, finished_at
     FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?`
  ).all(workflowId, limit, offset).map((row) => ({
    id: row.id,
    triggerKind: row.trigger_kind,
    status: row.status,
    error: row.error || null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    ms: row.finished_at && row.started_at ? row.finished_at - row.started_at : null,
  }))
}

export function getWorkflowRun(connectionId, workflowId, runId) {
  const row = meta.prepare(
    `SELECT id, trigger_kind, status, log, error, started_at, finished_at
     FROM workflow_runs WHERE id = ? AND workflow_id = ? AND connection_id = ?`
  ).get(runId, workflowId, connectionId)
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
