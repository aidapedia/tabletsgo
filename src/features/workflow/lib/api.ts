// Per-connection workflow automations, persisted on the backend. Mirrors the
// saved-queries client (savedQueries.ts) — reads degrade quietly, mutations throw.

import { request, safeRequest } from '@/shared/api/request'

export type WorkflowGraph = { nodes: any[]; edges: any[] }
export type WorkflowSummary = { id: string; name: string; ts: number }
export type Workflow = { id: string; name: string; graph: WorkflowGraph }

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
  fields: { name?: string; graph?: WorkflowGraph }
): Promise<void> {
  await request(`/connections/${connectionId}/workflows/${wid}`, { method: 'PUT', body: fields })
}

export async function deleteWorkflow(connectionId: string, wid: string): Promise<void> {
  await request(`/connections/${connectionId}/workflows/${wid}`, { method: 'DELETE' })
}

// Run the posted graph (so unsaved edits execute) — omit graph to run the stored one.
export async function runWorkflow(connectionId: string, wid: string, graph?: WorkflowGraph): Promise<RunResult> {
  return request(`/connections/${connectionId}/workflows/${wid}/run`, {
    method: 'POST',
    body: { graph },
  })
}
