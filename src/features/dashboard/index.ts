// Public API for the dashboard feature (New Relic-style query dashboards).
//
// NOTE: DashboardView is intentionally NOT re-exported here. It pulls in
// recharts + react-grid-layout (heavy), so consumers lazy-import it directly
// from `@/features/dashboard/components/DashboardView` — same pattern as
// WorkflowEditor in the workflow feature.
export { default as DashboardsPanel } from '@/features/dashboard/components/DashboardsPanel'
export {
  listDashboards,
  getDashboard,
  createDashboard,
  updateDashboard,
  deleteDashboard,
} from '@/features/dashboard/lib/api'
export { sanitizeConfig } from '@/features/dashboard/types'
export type { Dashboard, DashboardSummary, DashboardConfig, DashboardExport, Widget, DashboardVariable } from '@/features/dashboard/types'
