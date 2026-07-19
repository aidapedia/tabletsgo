// Public API for the dashboard feature (New Relic-style query dashboards).
//
// NOTE: DashboardView is intentionally NOT re-exported here. It pulls in
// react-grid-layout (heavy) plus the hand-rolled SVG charts, so consumers
// lazy-import it directly from `@/features/dashboard/components/DashboardView`
// — same pattern as WorkflowEditor in the workflow feature.
export { default as DashboardsPanel } from '@/features/dashboard/components/DashboardsPanel'
export {
  listDashboards,
  getDashboard,
  createDashboard,
  updateDashboard,
  deleteDashboard,
  fetchDashboardFolders,
  createDashboardFolder,
  renameDashboardFolder,
  moveDashboardFolder,
  deleteDashboardFolder,
} from '@/features/dashboard/lib/api'
// Generic markdown renderer (headings/lists/inline) — reused for release notes.
export { default as MarkdownText } from '@/features/dashboard/components/MarkdownText'
export { sanitizeConfig, MAX_DASHBOARD_FOLDER_DEPTH } from '@/features/dashboard/types'
export type { Dashboard, DashboardSummary, DashboardConfig, DashboardExport, DashboardFolder, Widget, DashboardVariable } from '@/features/dashboard/types'
