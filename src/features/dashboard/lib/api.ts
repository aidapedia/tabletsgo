// Per-connection dashboards, persisted on the backend. Mirrors the workflows
// client (features/workflow/lib/api.ts) — reads degrade quietly, mutations throw.

import { request, safeRequest } from '@/shared/api/request'
import type { Dashboard, DashboardConfig, DashboardSummary } from '../types'

export async function listDashboards(connectionId: string): Promise<DashboardSummary[]> {
  if (!connectionId) return []
  return safeRequest(`/connections/${connectionId}/dashboards`, [])
}

export async function getDashboard(connectionId: string, did: string): Promise<Dashboard> {
  return request(`/connections/${connectionId}/dashboards/${did}`)
}

// `config` is optional — passed when importing a JSON export as a new dashboard.
export async function createDashboard(connectionId: string, name: string, config?: DashboardConfig): Promise<Dashboard> {
  return request(`/connections/${connectionId}/dashboards`, { method: 'POST', body: { name, config } })
}

export async function updateDashboard(
  connectionId: string,
  did: string,
  fields: { name?: string; config?: DashboardConfig }
): Promise<void> {
  await request(`/connections/${connectionId}/dashboards/${did}`, { method: 'PUT', body: fields })
}

export async function deleteDashboard(connectionId: string, did: string): Promise<void> {
  await request(`/connections/${connectionId}/dashboards/${did}`, { method: 'DELETE' })
}
