// Applies a template to a connection: creates its workflows, resolves any
// {{workflow:<key>}} placeholders in dashboard row actions against the newly
// created ids, then creates its dashboards. No rollback on partial failure —
// whatever was created before the error stays; the caller surfaces the error
// and the user can delete stray artifacts manually.

import { createWorkflow, runWorkflow, sanitizeGraph } from '@/features/workflow'
import type { Workflow } from '@/features/workflow'
import { createDashboard, sanitizeConfig } from '@/features/dashboard'
import type { Dashboard } from '@/features/dashboard'
import type { Template } from '../types'

export type ApplyResult = { workflows: Workflow[]; dashboards: Dashboard[] }

const WORKFLOW_REF = /^\{\{workflow:(.+)\}\}$/

// Deep-walks the raw config, replacing any string that's *exactly* a
// `{{workflow:<key>}}` reference with the real created workflow id.
function resolveWorkflowRefs(raw: unknown, ids: Record<string, string>): unknown {
  if (typeof raw === 'string') {
    const m = raw.match(WORKFLOW_REF)
    if (!m) return raw
    const id = ids[m[1]]
    if (!id) throw new Error(`Template references unknown workflow "${m[1]}"`)
    return id
  }
  if (Array.isArray(raw)) return raw.map((v) => resolveWorkflowRefs(v, ids))
  if (raw && typeof raw === 'object') {
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, resolveWorkflowRefs(v, ids)]))
  }
  return raw
}

export async function applyTemplate(connectionId: string, template: Template): Promise<ApplyResult> {
  const ids: Record<string, string> = {}
  const workflows: Workflow[] = []
  for (const tw of template.workflows) {
    const wf = await createWorkflow(connectionId, tw.name, sanitizeGraph(tw.graph))
    ids[tw.key] = wf.id
    workflows.push(wf)
    if (tw.runOnApply) {
      const result = await runWorkflow(connectionId, wf.id)
      if (!result.ok) throw new Error(`Workflow "${tw.name}" failed: ${result.error || 'unknown error'}`)
    }
  }

  const dashboards: Dashboard[] = []
  for (const td of template.dashboards) {
    const resolved = resolveWorkflowRefs(td.config, ids)
    const d = await createDashboard(connectionId, td.name, sanitizeConfig(resolved))
    dashboards.push(d)
  }

  return { workflows, dashboards }
}
