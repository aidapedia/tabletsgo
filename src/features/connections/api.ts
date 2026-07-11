import { request, safeRequest } from '@/shared/api/request'

// ---- Connection access (which teams/members may see a connection) ----
// The team/member domain lives in `features/workspaces`; this endpoint is
// connection-scoped, so its client belongs here.
export type ConnectionAccess = { teams: string[]; users: string[] }

export async function getConnectionAccess(connectionId: string) {
  return safeRequest<ConnectionAccess>(`/connections/${connectionId}/access`, { teams: [], users: [] })
}
export async function setConnectionAccess(connectionId: string, access: ConnectionAccess) {
  return request<ConnectionAccess>(`/connections/${connectionId}/access`, { method: 'PUT', body: access })
}
