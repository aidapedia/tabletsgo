import { request, safeRequest } from '@/shared/api/request'

// Org/tenant "workspaces" (distinct from the DB-console `features/workspace`).
export type Workspace = {
  id: string
  name: string
  role: 'admin' | 'member'
  createdAt?: number
  experiments?: Record<string, boolean>
}

export async function listWorkspaces() {
  return safeRequest<Workspace[]>('/workspaces', [])
}
export async function getWorkspace(id: string) {
  return request<any>(`/workspaces/${id}`)
}
export async function createWorkspace(name: string) {
  return request<Workspace>('/workspaces', { method: 'POST', body: { name } })
}
export async function updateWorkspace(id: string, patch: { name?: string; smtp?: any; experiments?: Record<string, boolean> }) {
  return request(`/workspaces/${id}`, { method: 'PUT', body: patch })
}
export async function testSmtp(id: string, body: { to?: string; smtp?: any }) {
  return request<{ ok: true }>(`/workspaces/${id}/smtp/test`, { method: 'POST', body })
}
export async function deleteWorkspace(id: string) {
  return request(`/workspaces/${id}`, { method: 'DELETE' })
}

export type Member = { userId: string; email: string; name: string; role: 'admin' | 'member'; status: 'active' | 'pending' }

export async function listMembers(workspaceId: string) {
  return safeRequest<Member[]>(`/workspaces/${workspaceId}/members`, [])
}
export async function inviteMember(workspaceId: string, email: string) {
  return request<{ member: Member; inviteLink: string | null; emailed: boolean }>(`/workspaces/${workspaceId}/members`, {
    method: 'POST',
    body: { email },
  })
}
export async function removeMember(workspaceId: string, userId: string) {
  return request(`/workspaces/${workspaceId}/members/${userId}`, { method: 'DELETE' })
}
