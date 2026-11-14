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
 * Only a label now: 'owner' for the Hayat tenant's owner, 'member' for everyone
 * else. Roles are granted in Hayat.
 *
 * **Don't branch on it.** Ask `permissions` what the caller may do:
 * `can(current, 'storage.manage')` — Hayat answers by permission too.
 */
export type WorkspaceRole = string

/**
 * The permission keys the server enforces (server/permissions-catalog.js; Hayat
 * holds them as `tabletsgo.<key>`, or `hayat.*` for the people ones). Kept
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
  | 'ssh.manage'
  | 'connections.create'
  | 'connections.manage'
  | 'connections.transfer'
  | 'connection.open'
  | 'resources.organise'
  | 'resources.grant'

export type Workspace = {
  id: string
  name: string
  role: WorkspaceRole
  // What the caller may do here. Ships with every workspace payload so gating a
  // button never needs its own request; the server enforces all of it anyway.
  permissions?: Permission[]
  memberCount?: number
  experiments?: Record<string, boolean>
  notifications?: NotificationSettings
  sessions?: SessionSettings
  // The tenant in Hayat's console — where its name, members and groups change.
  manageUrl?: string | null
  // Its resource tree there: groups, and who may open what.
  treeUrl?: string | null
}

// The one way the UI asks "may I?". Undefined permissions (an older server, or a
// workspace that hasn't loaded) answer false — the UI hides rather than offers
// something the server will refuse.
export const can = (ws: { permissions?: Permission[] } | null | undefined, permission: Permission) =>
  !!ws?.permissions?.includes(permission)

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
export async function updateWorkspace(
  id: string,
  patch: {
    experiments?: Record<string, boolean>
    notifications?: NotificationSettings
    sessions?: { maxPerConnection: number }
  }
) {
  return request(`/workspaces/${id}`, { method: 'PUT', body: patch })
}
// Removes tabletsgo's data for the workspace; the tenant stays in Hayat.
export async function deleteWorkspace(id: string) {
  return request(`/workspaces/${id}`, { method: 'DELETE' })
}

// How a grant reaches a member: granted to them, to a group they are on, or to
// everyone in the workspace — or `owner`, a thing they own (no role).
export type GrantVia = 'owner' | 'user' | 'group' | 'everyone'

// A role someone holds on the workspace itself (Hayat's grant, by name).
export type MemberRole = { role: string; name: string; via: Exclude<GrantVia, 'owner'>; groupName: string | null }

export type Member = {
  userId: string
  email: string
  name: string
  role: WorkspaceRole
  // Their roles on the workspace, from Hayat's grants.
  roles?: MemberRole[]
  // What those add up to, resolved by Hayat; `isOwner` is the tenant's owner.
  permissions?: Permission[]
  isOwner?: boolean
  status: 'active' | 'pending' | 'disabled'
}

// One line of a member's Access list: something granted to them, or owned.
export type MemberAccess = {
  kind: 'workspace' | 'group' | 'connection' | 'storage'
  // A connection's or storage destination's id; the Hayat node for the others.
  id: string
  name: string
  via: GrantVia
  role: string | null
  roleName: string | null
  // Reaches what is filed below it too.
  inherit: boolean
  groupName: string | null
}

export type MemberDetail = Member & { access: MemberAccess[] }

export async function listMembers(workspaceId: string) {
  return safeRequest<Member[]>(`/workspaces/${workspaceId}/members`, [])
}

// One member and their access; null when they aren't on this workspace's roster.
export async function getMember(workspaceId: string, userId: string) {
  return safeRequest<MemberDetail | null>(`/workspaces/${workspaceId}/members/${encodeURIComponent(userId)}`, null)
}
