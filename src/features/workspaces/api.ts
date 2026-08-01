import { request, safeRequest } from '@/shared/api/request'

// Org/tenant "workspaces" (distinct from the DB-console `features/workspace`).
export type NotificationSettings = {
  backupFailure?: { enabled: boolean; memberIds: string[] }
}

// Workspace-wide session policy. `maxPerConnection` 0 = unlimited;
// `instanceDefault` is the MAX_SESSIONS_PER_CONNECTION env fallback that applies
// when the workspace leaves it at 0 (read-only — shown so the form can say what
// is actually in effect).
export type SessionSettings = { maxPerConnection: number; instanceDefault?: number }

// A workspace membership is either 'owner' (manages the workspace: members,
// teams, settings, connections) or 'member' (uses the connections they've been
// granted). Distinct from the *system* role on the account — see
// `features/admin`. Pre-v8 servers spelled 'owner' as 'admin'.
export type WorkspaceRole = 'owner' | 'member'

export type Workspace = {
  id: string
  name: string
  role: WorkspaceRole
  createdAt?: number
  experiments?: Record<string, boolean>
  notifications?: NotificationSettings
  sessions?: SessionSettings
}

// The instance's mail server, as reported to a workspace owner: read-only here
// (an instance admin configures it), non-secret fields only, and null when the
// instance has none. `source` says which layer answered — the admin's saved
// config, or the SMTP_* env vars under it.
export type InstanceSmtp = {
  source: 'global' | 'env'
  host: string
  port?: string | number
  secure?: boolean
  user?: string
  from?: string
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
export async function updateWorkspace(
  id: string,
  patch: {
    name?: string
    experiments?: Record<string, boolean>
    notifications?: NotificationSettings
    sessions?: { maxPerConnection: number }
  }
) {
  return request(`/workspaces/${id}`, { method: 'PUT', body: patch })
}
export async function deleteWorkspace(id: string) {
  return request(`/workspaces/${id}`, { method: 'DELETE' })
}

export type Member = {
  userId: string
  email: string
  name: string
  role: WorkspaceRole
  status: 'active' | 'pending'
  systemRole?: 'admin' | 'user'
}

export async function listMembers(workspaceId: string) {
  return safeRequest<Member[]>(`/workspaces/${workspaceId}/members`, [])
}
export async function inviteMember(workspaceId: string, email: string) {
  return request<{ member: Member; inviteLink: string | null; emailed: boolean }>(`/workspaces/${workspaceId}/members`, {
    method: 'POST',
    body: { email },
  })
}
// Promote a member to owner, or demote one back. A workspace can have any
// number of owners but never zero.
export async function setMemberRole(workspaceId: string, userId: string, role: WorkspaceRole) {
  return request(`/workspaces/${workspaceId}/members/${userId}`, { method: 'PUT', body: { role } })
}
export async function removeMember(workspaceId: string, userId: string) {
  return request(`/workspaces/${workspaceId}/members/${userId}`, { method: 'DELETE' })
}

// ---- Teams (workspace-scoped groups of members) ----
export type Team = { id: string; name: string; memberCount: number; createdAt?: number }
export type TeamMember = { userId: string; email: string; name: string }

export async function listTeams(workspaceId: string) {
  return safeRequest<Team[]>(`/workspaces/${workspaceId}/teams`, [])
}
export async function createTeam(workspaceId: string, name: string) {
  return request<Team>(`/workspaces/${workspaceId}/teams`, { method: 'POST', body: { name } })
}
export async function renameTeam(workspaceId: string, teamId: string, name: string) {
  return request(`/workspaces/${workspaceId}/teams/${teamId}`, { method: 'PUT', body: { name } })
}
export async function deleteTeam(workspaceId: string, teamId: string) {
  return request(`/workspaces/${workspaceId}/teams/${teamId}`, { method: 'DELETE' })
}
export async function listTeamMembers(workspaceId: string, teamId: string) {
  return safeRequest<TeamMember[]>(`/workspaces/${workspaceId}/teams/${teamId}/members`, [])
}
export async function addTeamMember(workspaceId: string, teamId: string, userId: string) {
  return request(`/workspaces/${workspaceId}/teams/${teamId}/members`, { method: 'POST', body: { userId } })
}
export async function removeTeamMember(workspaceId: string, teamId: string, userId: string) {
  return request(`/workspaces/${workspaceId}/teams/${teamId}/members/${userId}`, { method: 'DELETE' })
}
