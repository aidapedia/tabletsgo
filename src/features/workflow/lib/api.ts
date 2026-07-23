// Per-connection workflow automations, persisted on the backend. Mirrors the
// saved-queries client (savedQueries.ts) — reads degrade quietly, mutations throw.

import { request, safeRequest } from '@/shared/api/request'

export type WorkflowGraph = { nodes: any[]; edges: any[] }
export type WorkflowSummary = {
  id: string
  name: string
  ts: number
  protected: boolean
  scheduleEnabled: boolean
}
export type Workflow = {
  id: string
  name: string
  graph: WorkflowGraph
  protected: boolean
  scheduleEnabled: boolean
}

// One entry per executed node, in execution order.
export type RunLogEntry = {
  nodeId: string
  nodeType: string
  status: 'ok' | 'error'
  ms: number
  output?: unknown
  logs?: string[]
  error?: string
}
export type RunResult = { ok: boolean; log: RunLogEntry[]; output?: unknown; error?: string }

// How a run was triggered, recorded in the activity trail.
export type TriggerKind = 'manual' | 'dashboard' | 'schedule' | 'webhook'
// A row in the run-history list (log omitted — fetch a single run to drill in).
export type WorkflowRunSummary = {
  id: string
  triggerKind: TriggerKind
  status: 'success' | 'failed'
  error: string | null
  startedAt: number
  finishedAt: number
  ms: number | null
}
// A single run with its full per-node log.
export type WorkflowRunDetail = WorkflowRunSummary & { ok: boolean; log: RunLogEntry[] }

export async function listWorkflows(connectionId: string): Promise<WorkflowSummary[]> {
  if (!connectionId) return []
  return safeRequest(`/connections/${connectionId}/workflows`, [])
}

export async function getWorkflow(connectionId: string, wid: string): Promise<Workflow> {
  return request(`/connections/${connectionId}/workflows/${wid}`)
}

export async function createWorkflow(connectionId: string, name: string): Promise<Workflow> {
  return request(`/connections/${connectionId}/workflows`, { method: 'POST', body: { name } })
}

export async function updateWorkflow(
  connectionId: string,
  wid: string,
  fields: { name?: string; graph?: WorkflowGraph; scheduleEnabled?: boolean }
): Promise<void> {
  await request(`/connections/${connectionId}/workflows/${wid}`, { method: 'PUT', body: fields })
}

export async function deleteWorkflow(connectionId: string, wid: string): Promise<void> {
  await request(`/connections/${connectionId}/workflows/${wid}`, { method: 'DELETE' })
}

// Run the posted graph (so unsaved edits execute) — omit graph to run the stored one.
// `input` seeds the trigger node (e.g. a dashboard table row): JS nodes receive it
// as `input`, query nodes can inline scalars with {{input.field}}. `trigger` tags
// the run in the audit trail ('manual' default).
export async function runWorkflow(
  connectionId: string,
  wid: string,
  graph?: WorkflowGraph,
  input?: unknown,
  trigger?: 'manual' | 'dashboard'
): Promise<RunResult> {
  return request(`/connections/${connectionId}/workflows/${wid}/run`, {
    method: 'POST',
    body: { graph, input, trigger },
  })
}

// Activity trail: recent runs of a workflow (newest first). Degrades quietly.
export async function listWorkflowRuns(connectionId: string, wid: string): Promise<WorkflowRunSummary[]> {
  if (!connectionId || !wid) return []
  return safeRequest(`/connections/${connectionId}/workflows/${wid}/runs`, [])
}

// One run with its full stored per-node log.
export async function getWorkflowRun(connectionId: string, wid: string, runId: string): Promise<WorkflowRunDetail> {
  return request(`/connections/${connectionId}/workflows/${wid}/runs/${runId}`)
}
