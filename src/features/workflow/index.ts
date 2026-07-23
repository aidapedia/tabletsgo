// Public API for the workflow feature (React Flow builder + server-side runner).
//
// NOTE: WorkflowEditor is intentionally NOT re-exported here. It pulls in React
// Flow (heavy), so consumers lazy-import it directly from
// `@/features/workflow/components/WorkflowEditor`. Re-exporting it from this
// barrel would statically bind it to every eager importer of the barrel
// (e.g. WorkspacePage, which also needs WorkflowsPanel + the API), collapsing it
// back into the main bundle and defeating the code-split.
export { default as WorkflowsPanel } from '@/features/workflow/components/WorkflowsPanel'
export {
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  runWorkflow,
} from '@/features/workflow/lib/api'
export type { Workflow, WorkflowSummary, WorkflowGraph, RunResult, RunLogEntry } from '@/features/workflow/lib/api'
export { sanitizeGraph, stripSecrets } from '@/features/workflow/lib/exportImport'
export type { WorkflowExport } from '@/features/workflow/lib/exportImport'
