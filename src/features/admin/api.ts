import { request, safeRequest } from '@/shared/api/request'
import type { WorkspaceRole } from '@/features/workspaces'

/**
 * Instance administration — the `/api/admin/*` surface, open only to accounts
 * whose *system* role is 'admin'.
 *
 * The two role tiers are independent: `SystemRole` says what an account is on
 * the instance, `WorkspaceRole` says what it is inside one workspace. An
 * instance admin holds no workspace membership at all, which is why this
 * feature can manage workspaces without ever opening one.
 */
export type SystemRole = 'admin' | 'user'

export type AdminWorkspaceMember = {
  userId: string
  email: string
  name: string
  role: WorkspaceRole
  status: 'active' | 'pending'
  systemRole?: SystemRole
  createdAt?: number
}

export type AdminWorkspace = {
  id: string
  name: string
  createdAt?: number
  memberCount: number
  teamCount: number
  connectionCount: number
  owners: AdminWorkspaceMember[]
}

export type AdminUser = {
  id: string
  email: string
  name: string
  role: SystemRole
  status: 'active' | 'pending'
  workspaces: { id: string; name: string; role: WorkspaceRole }[]
}

// ---- Workspaces ----

export async function listAllWorkspaces() {
  return safeRequest<AdminWorkspace[]>('/admin/workspaces', [])
}

// `ownerEmail` may be an unknown address — the server then creates a pending
// account and returns an invite link.
export async function createWorkspaceAs(name: string, ownerEmail: string) {
  return request<{ workspace: AdminWorkspace; inviteLink: string | null; emailed: boolean }>('/admin/workspaces', {
    method: 'POST',
    body: { name, ownerEmail },
  })
}

export async function renameWorkspaceAs(id: string, name: string) {
  return request(`/admin/workspaces/${id}`, { method: 'PUT', body: { name } })
}

export async function deleteWorkspaceAs(id: string) {
  return request<{ ok: true; connectionsDeleted: number }>(`/admin/workspaces/${id}`, { method: 'DELETE' })
}

export async function listWorkspaceMembersAs(id: string) {
  return safeRequest<AdminWorkspaceMember[]>(`/admin/workspaces/${id}/members`, [])
}

export async function setWorkspaceRoleAs(id: string, userId: string, role: WorkspaceRole) {
  return request(`/admin/workspaces/${id}/members/${userId}`, { method: 'PUT', body: { role } })
}

export async function removeWorkspaceMemberAs(id: string, userId: string) {
  return request(`/admin/workspaces/${id}/members/${userId}`, { method: 'DELETE' })
}

// ---- Users ----

export async function listUsers() {
  return safeRequest<AdminUser[]>('/admin/users', [])
}

// Omit `password` to create a pending account instead — the returned invite
// link is how that person sets their own.
export async function createUser(body: { email: string; name?: string; password?: string; role?: SystemRole }) {
  return request<{ user: AdminUser; inviteLink: string | null }>('/admin/users', { method: 'POST', body })
}

export async function updateUser(id: string, patch: { name?: string; password?: string; role?: SystemRole }) {
  return request<AdminUser>(`/admin/users/${id}`, { method: 'PUT', body: patch })
}

export async function deleteUser(id: string) {
  return request(`/admin/users/${id}`, { method: 'DELETE' })
}
