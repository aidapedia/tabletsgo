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

/**
 * A membership's role is a *slug* from the instance's role catalog, which an
 * instance admin edits — so it's an open string, not a union. 'owner' and
 * 'member' are the seeded builtins (pre-v8 servers spelled 'owner' as 'admin').
 *
 * **Don't branch on the slug.** Ask `permissions` what the caller may do:
 * `can(current, 'members.manage')`. A custom role named anything at all can
 * carry the same capability, and the server authorizes by permission too.
 */
export type WorkspaceRole = string

/**
 * The permission keys the server enforces (server/permissions-catalog.js). Kept
 * as a union so a typo in a `can(...)` call is a compile error rather than a
 * silently-false check.
 */
export type Permission =
  | 'workspace.manage'
  | 'workspace.delete'
  | 'members.manage'
  | 'teams.manage'
  | 'notifications.manage'
  | 'storage.manage'
  | 'connections.create'
  | 'connections.manage'
  | 'connections.transfer'

export type Workspace = {
  id: string
  name: string
  role: WorkspaceRole
  // What the caller may do here. Ships with every workspace payload so gating a
  // button never needs its own request; the server enforces all of it anyway.
  permissions?: Permission[]
  createdAt?: number
  experiments?: Record<string, boolean>
  notifications?: NotificationSettings
  sessions?: SessionSettings
}

// The one way the UI asks "may I?". Undefined permissions (an older server, or a
// workspace that hasn't loaded) answer false — the UI hides rather than offers
// something the server will refuse.
export const can = (ws: { permissions?: Permission[] } | null | undefined, permission: Permission) =>
  !!ws?.permissions?.includes(permission)

// ---- Roles (the instance-wide catalog an admin defines) ----
export type Role = {
  id: string
  slug: string
  name: string
  description: string
  builtin: boolean
  permissions: Permission[]
  // Memberships across the instance holding this role — who an edit affects, and
  // why a delete would be refused.
  memberCount?: number
  createdAt?: number
  updatedAt?: number
}

// One permission as the admin editor renders it, grouped by area.
export type PermissionGroup = {
  group: string
  items: { key: Permission; label: string; description: string }[]
}

// Readable by any signed-in user: assigning a member a role needs the names.
export async function listRoles() {
  return safeRequest<Role[]>('/roles', [])
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
  // What this person's role grants, and whether it makes them an owner (i.e.
  // carries workspace.manage) — resolved by the server so the list doesn't have
  // to know what any role means.
  permissions?: Permission[]
  isOwner?: boolean
  status: 'active' | 'pending'
  systemRole?: 'admin' | 'user'
}

export async function listMembers(workspaceId: string) {
  return safeRequest<Member[]>(`/workspaces/${workspaceId}/members`, [])
}
// Invites straight into a role, so there's no "add then promote" round trip.
export async function inviteMember(workspaceId: string, email: string, role: WorkspaceRole = 'member') {
  return request<{ member: Member; inviteLink: string | null; emailed: boolean }>(`/workspaces/${workspaceId}/members`, {
    method: 'POST',
    body: { email, role },
  })
}
// Move a member to a different role. A workspace can have any number of owners
// but never zero, so the server refuses to move the last one out of a role that
// carries workspace.manage.
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
