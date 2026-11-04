import { request, safeRequest } from '@/shared/api/request'
import type { Permission, WorkspaceRole } from '@/features/workspaces'

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
  // What this person's role grants, and whether it carries `workspace.manage`
  // (which is what "owner" means now that roles are configurable). Resolved
  // server-side so nothing here has to interpret a role slug.
  permissions?: Permission[]
  isOwner?: boolean
  status: 'active' | 'pending'
  systemRole?: SystemRole
  createdAt?: number
  // The brute-force guard's block, how they can sign in, and how many of this
  // workspace's groups they're on.
  blocked?: boolean
  signIn?: ('password' | 'google' | 'github')[]
  groupCount?: number
}

export type AdminWorkspaceOverview = {
  workspace: {
    id: string
    name: string
    createdAt?: number
    lastActivityAt: number | null
    maxSessionsPerConnection: number
    backupFailureAlerts: boolean
  }
  owners: { userId: string; name: string; email: string }[]
  counts: {
    members: number
    pendingMembers: number
    connections: number
    lockedConnections: number
    groups: number
    dashboards: number
    workflows: number
    scheduledWorkflows: number
    savedQueries: number
    schemaDrafts: number
    storageDestinations: number
    sshHosts: number
    sshKeys: number
  }
  queries: { days: { day: string; total: number; failed: number }[]; total: number; failed: number }
  backups: { runs: number; succeeded: number }
  engines: { type: string; count: number; locked: boolean }[]
  environments: { environment: string; count: number }[]
  attention: {
    lockedConnections: string[]
    failingBackups: { connectionId: string; name: string; consecutiveFailures: number; lastSuccessAt: number | null }[]
  }
}

export type AdminWorkspaceConnection = {
  id: string
  name: string
  type: string
  environment: string | null
  state: 'active' | 'locked'
  ownerName: string | null
  // Members who can actually open it, resolved person by person.
  canOpen: number
  backup: { frequency: 'hourly' | 'daily'; hourOfDay: number; consecutiveFailures: number } | null
  createdAt?: number
}

export type AdminWorkspaceResources = {
  totals: {
    dashboards: { total: number; connections: number }
    workflows: { total: number; connections: number }
    savedQueries: { total: number; connections: number }
    scheduledWorkflows: number
    schemaDrafts: number
  }
  groups: { id: string; name: string; people: number; connections: number }[]
  storage: { id: string; name: string; bucket: string; region: string | null; schedules: number }[]
  sshHosts: { id: string; name: string; host: string; port: number; transport: 'tcp' | 'cloudflare'; hostKeyPinned: boolean }[]
  sshKeys: { id: string; name: string; algorithm: string | null; fingerprint: string | null }[]
}

export type AdminWorkspaceRun = {
  id: string
  kind: 'backup' | 'workflow'
  name: string | null
  connectionId: string
  connectionName: string | null
  trigger: string
  status: string
  startedAt: number
  finishedAt: number | null
}

export type AdminWorkspaceActivity = {
  busiestConnections: { id: string; name: string; queries: number }[]
  activeMembers: { id: string; name: string; queries: number }[]
  runs: AdminWorkspaceRun[]
}

export type AdminWorkspace = {
  id: string
  name: string
  createdAt?: number
  memberCount: number
  groupCount: number
  connectionCount: number
  owners: AdminWorkspaceMember[]
}

/**
 * `status` is the invite lifecycle ('pending' until they set a password);
 * `blocked` is separate — the brute-force guard blocked the account after
 * `failedAttempts` bad sign-ins. `blockedUntil` is null for the ordinary block,
 * which only an admin lifts; an instance admin is only ever thrown a cooldown,
 * so theirs always carries a timestamp.
 */
export type AdminUser = {
  id: string
  email: string
  name: string
  role: SystemRole
  status: 'active' | 'pending'
  blocked: boolean
  blockedAt: number | null
  blockedUntil: number | null
  failedAttempts: number
  hasPassword: boolean
  identities: { id: string; provider: 'google' | 'github'; email: string | null; createdAt: number; lastUsedAt: number | null }[]
  // `roleName` is the role's display name and `isOwner` whether it carries
  // workspace.manage — both resolved server-side, since a role slug means
  // whatever an admin has defined it to mean.
  workspaces: { id: string; name: string; role: WorkspaceRole; roleName?: string; isOwner?: boolean }[]
}

// ---- Workspaces ----

export async function listAllWorkspaces() {
  return safeRequest<AdminWorkspace[]>('/admin/workspaces', [])
}

// `ownerEmail` must belong to an account that already exists — the server
// refuses an unknown address. A `pending` owner gets an invite link back.
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

// `null` when the workspace doesn't exist, which the detail page says out loud.
export async function getWorkspaceOverview(id: string) {
  return safeRequest<AdminWorkspaceOverview | null>(`/admin/workspaces/${id}/overview`, null)
}

export async function listWorkspaceConnectionsAs(id: string) {
  return safeRequest<AdminWorkspaceConnection[]>(`/admin/workspaces/${id}/connections`, [])
}

export async function getWorkspaceResources(id: string) {
  return safeRequest<AdminWorkspaceResources | null>(`/admin/workspaces/${id}/resources`, null)
}

export async function getWorkspaceActivity(id: string) {
  return safeRequest<AdminWorkspaceActivity | null>(`/admin/workspaces/${id}/activity`, null)
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

// Lift a brute-force block and clear the failed-attempt counter. Setting a new
// password does the same, so this is the "it was really them" path.
export async function unblockUser(id: string) {
  return request<AdminUser>(`/admin/users/${id}/unblock`, { method: 'POST' })
}

// ---- Global email (SMTP) ----

/**
 * The instance-wide mail server. It is the fallback every workspace inherits
 * when it hasn't configured its own, and it sits above the SMTP_* env vars —
 * so an env-configured instance keeps working, and saving here takes over.
 * The password is write-only: reads report `hasPassword`, never the secret.
 */
export type GlobalSmtp = {
  host: string
  port: string | number
  secure: boolean
  user: string
  from: string
  hasPassword: boolean
}

// `env` is the layer underneath — non-secret, and null when SMTP_HOST is unset.
export type GlobalSmtpInfo = {
  smtp: GlobalSmtp
  env: { host: string; port: string; secure: boolean; user: string; from: string } | null
}

export async function getGlobalSmtp() {
  return request<GlobalSmtpInfo>('/admin/smtp')
}

// Omit `pass` to keep the stored password; `null` clears it.
export async function updateGlobalSmtp(body: {
  host?: string
  port?: number
  secure?: boolean
  user?: string
  from?: string
  pass?: string | null
}) {
  return request<{ smtp: GlobalSmtp }>('/admin/smtp', { method: 'PUT', body })
}

// Drop the global config — the instance falls back to the env vars, if any.
export async function clearGlobalSmtp() {
  return request<{ ok: true; smtp: GlobalSmtp }>('/admin/smtp', { method: 'DELETE' })
}

export async function testGlobalSmtp(body: { to?: string; smtp?: any }) {
  return request<{ ok: true }>('/admin/smtp/test', { method: 'POST', body })
}

// ---- Sign-in providers ----

export type AdminIdentityProvider = {
  kind: 'google' | 'github'
  label: string
  clientId: string
  hasSecret: boolean
  enabled: boolean
  linked: number
}

export async function getIdentityProviders() {
  return request<{ providers: AdminIdentityProvider[]; callbackUrl: string }>('/admin/identity-providers')
}
export async function saveIdentityProvider(kind: string, body: { clientId?: string; clientSecret?: string; enabled?: boolean }) {
  return request<{ providers: AdminIdentityProvider[] }>(`/admin/identity-providers/${kind}`, { method: 'PUT', body })
}
export async function clearIdentityProvider(kind: string) {
  return request<{ providers: AdminIdentityProvider[] }>(`/admin/identity-providers/${kind}`, { method: 'DELETE' })
}
