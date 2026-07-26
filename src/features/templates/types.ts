// Shapes for the built-in template catalog (browse + apply only — templates
// are bundled with the app, not user-editable; see lib/apply.ts for the apply
// pipeline and catalog/ for the shipped templates).

import type { WorkflowGraph } from '@/features/workflow'

/** DB types a template can target — a subset of connections' DB_CATALOG ids. */
export type TemplateDbType = 'postgresql' | 'sqlite'

export type TemplateWorkflow = {
  /** Template-local key, referenced by other artifacts as `{{workflow:<key>}}`. */
  key: string
  name: string
  graph: WorkflowGraph
  /** Run once right after creation (setup/seed workflows). Most templates omit this. */
  runOnApply?: boolean
}

export type TemplateDashboard = {
  name: string
  /** Raw, DashboardConfig-shaped JSON. May contain `{{workflow:<key>}}` placeholders
   * in row-action `workflowId` fields; resolved then sanitized at apply time. */
  config: unknown
}

export type Template = {
  /** Stable slug, e.g. 'pg-health-vacuum'. */
  id: string
  name: string
  /** 1-3 sentences shown on the gallery card and detail view. */
  description: string
  databases: TemplateDbType[]
  /** Applied first, in order, so dashboards can reference the created ids. */
  workflows: TemplateWorkflow[]
  /** Applied second, in order. */
  dashboards: TemplateDashboard[]
}
