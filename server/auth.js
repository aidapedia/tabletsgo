/**
 * Sessions, request guards and the workspace/team membership rules that decide
 * who may see a connection.
 *
 * Roles come in two independent tiers (CLAUDE.md "AUTH MODEL"):
 *
 *   system   `users.role` — 'admin' | 'user'. An 'admin' administers the
 *            instance (workspaces + accounts) and deliberately holds no
 *            workspace membership, so `memberRole` returns null for them and
 *            every workspace-scoped guard below denies them. Instance
 *            administration carries no data access, by design.
 *   workspace `workspace_members.role` — a role *slug* from the `roles` table
 *            (server/permissions.js). What it grants is data an instance admin
 *            edits, so this tier is asked about by permission
 *            (`requirePermission(req, res, wsId, 'members.manage')`) rather than
 *            by name. 'owner' and 'member' are seeded builtins.
 *
 * The system tier is deliberately NOT part of that model: making it configurable
 * would only be a way to grant an instance admin the workspace data they are
 * meant not to have.
 *
 * A login is a bearer token in the session store (server/sessions): a row in
 * the meta DB's `sessions` table, read through an in-process cache, so it
 * survives a restart and the store expires it on its own.
 *
 * The store is async while `requireAuth` is called synchronously by ~100 routes,
 * so the token is resolved once per request by `sessionMiddleware` and parked on
 * `req`. Everything downstream reads that — no route had to change.
 */

import { randomUUID } from 'crypto'
import { createAuthSession, destroyAuthSession, readAuthSession } from './sessions/index.js'
import { meta } from './meta.js'
import { OWNER_PERMISSION, permissionsForRole, roleHasPermission } from './permissions.js'

// ---- Sessions ----
export const createSession = (userId, context) => createAuthSession(userId, context)

export const deleteSession = (token) => destroyAuthSession(token)

export const bearerToken = (req) => {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

export const userRow = (id) =>
  meta.prepare('SELECT id, username, name, role, status FROM users WHERE id = ?').get(id) || null

export async function userFromToken(token) {
  const session = await readAuthSession(token)
  return session ? userRow(session.userId) : null
}

/**
 * Resolve the caller once per request, before any route runs. A store failure is
 * not fatal: it means "not signed in" (401 from the guards), never a 500.
 */
export async function sessionMiddleware(req, _res, next) {
  const token = bearerToken(req)
  if (token) {
    try {
      req.authUser = await userFromToken(token)
      req.authToken = token
    } catch (error) {
      console.error('Session lookup failed:', error.message)
    }
  }
  next()
}

// Resolve the caller from the Bearer token (null if unauthenticated).
export const authUser = (req) => req.authUser || null

// Public shape returned to the client (never the password hash).
export const publicUser = (u) => (u ? { id: u.id, email: u.username, name: u.name, role: u.role } : null)

// Require an authenticated caller; sends 401 and returns null otherwise.
export const requireAuth = (req, res) => {
  const user = authUser(req)
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
  return user
}

// ---- System role ----
export const isSystemAdmin = (user) => !!user && user.role === 'admin'

export const requireSystemAdmin = (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return null
  if (!isSystemAdmin(user)) {
    res.status(403).json({ error: 'Admin access required' })
    return null
  }
  return user
}

// ---- Workspace helpers ----
/**
 * The caller's role in a workspace, or null if they aren't a member — which is
 * always the case for an instance admin, and is what stops instance
 * administration from reaching workspace data.
 *
 * 'admin' is the pre-v8 spelling of 'owner'; normalizing here means a DB that
 * has been rolled back and forward again never exposes a mixed vocabulary.
 */
export const memberRole = (workspaceId, userId) => {
  const m = meta.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, userId)
  if (!m) return null
  return m.role === 'admin' ? 'owner' : m.role
}

// Everything the caller may do in this workspace — an empty set for a non-member
// (which is always the case for an instance admin).
export const permissionsIn = (workspaceId, userId) => permissionsForRole(memberRole(workspaceId, userId))

// The permission check. `workspaceId` null/undefined ⇒ false, so a resource with
// no workspace never accidentally authorizes anyone.
export const can = (workspaceId, userId, permission) => (workspaceId ? roleHasPermission(memberRole(workspaceId, userId), permission) : false)

/**
 * "Owner" is no longer a role name, it's a capability: whoever holds
 * `workspace.manage`. Keeping the concept behind this helper is what lets a
 * renamed or custom role satisfy the last-owner invariant just like the built-in
 * `owner` does.
 */
export const isWorkspaceOwner = (workspaceId, userId) => can(workspaceId, userId, OWNER_PERMISSION)

/**
 * The workspace-tier guard. Routes read
 * `if (!requirePermission(req, res, id, 'teams.manage')) return` — a route asks
 * for the capability it needs and never compares a role name, so redefining what
 * a role grants changes who may call it without touching the route.
 *
 * The 403 distinguishes "you're in this workspace but may not do this" from
 * "you're not in this workspace at all", which is what the UI needs to tell a
 * member to ask an owner versus telling them the workspace doesn't exist.
 */
export const requirePermission = (req, res, workspaceId, permission) => {
  const user = requireAuth(req, res)
  if (!user) return null
  const role = memberRole(workspaceId, user.id)
  if (!roleHasPermission(role, permission)) {
    res.status(403).json({ error: role ? 'You do not have permission to do that.' : 'Forbidden', permission })
    return null
  }
  return user
}

// Guard for anything any member of the workspace may do.
export const requireMember = (req, res, workspaceId) => {
  const user = requireAuth(req, res)
  if (!user) return null
  if (!memberRole(workspaceId, user.id)) {
    res.status(403).json({ error: 'Forbidden' })
    return null
  }
  return user
}

/**
 * The workspace as this user sees it. `permissions` ships with it so the client
 * can hide what the caller can't do from one payload instead of re-deriving the
 * rules — the server still enforces every one of them.
 */
export const workspaceForUser = (id, userId) => {
  const role = memberRole(id, userId)
  if (!role) return null
  const w = meta.prepare('SELECT id, name, created_at FROM workspaces WHERE id = ?').get(id)
  return w ? { id: w.id, name: w.name, role, permissions: [...permissionsForRole(role)], createdAt: w.created_at } : null
}

export const getUserByEmail = (email) =>
  meta.prepare('SELECT id, username, name, role, status FROM users WHERE username = ?').get(email)

// ---- Team / connection-access helpers ----
// Team ids the user belongs to within a given workspace.
export const teamIdsForUser = (workspaceId, userId) =>
  meta
    .prepare(
      `SELECT tm.team_id AS id FROM team_members tm JOIN teams t ON t.id = tm.team_id
       WHERE t.workspace_id = ? AND tm.user_id = ?`
    )
    .all(workspaceId, userId)
    .map((r) => r.id)

// Assigned principals for a connection, split into team/user id arrays.
export const connectionAccess = (connectionId) => {
  const rows = meta.prepare('SELECT principal_type, principal_id FROM connection_access WHERE connection_id = ?').all(connectionId)
  return {
    teams: rows.filter((r) => r.principal_type === 'team').map((r) => r.principal_id),
    users: rows.filter((r) => r.principal_type === 'user').map((r) => r.principal_id),
  }
}

// Replace a connection's access list atomically. Empty arrays => open to all members.
export const setConnectionAccess = (connectionId, { teams = [], users = [] }) => {
  const now = Date.now()
  const tx = meta.transaction(() => {
    meta.prepare('DELETE FROM connection_access WHERE connection_id = ?').run(connectionId)
    const ins = meta.prepare('INSERT OR IGNORE INTO connection_access (id, connection_id, principal_type, principal_id, created_at) VALUES (?, ?, ?, ?, ?)')
    for (const t of teams) ins.run(randomUUID(), connectionId, 'team', t, now)
    for (const u of users) ins.run(randomUUID(), connectionId, 'user', u, now)
  })
  tx()
}

// Can this user see/open the connection? Whoever manages every connection in the
// workspace always can, and so does the connection's own owner; an unassigned
// connection is open to every workspace member; otherwise the user must be a
// listed individual or belong to a listed team.
export const userCanAccessConnection = (conn, userId) => {
  if (!conn) return false
  if (!conn.workspaceId) return true
  const role = memberRole(conn.workspaceId, userId)
  if (!role) return false
  if (roleHasPermission(role, 'connections.manage')) return true
  if (conn.ownerId && conn.ownerId === userId) return true
  const { teams, users } = connectionAccess(conn.id)
  if (teams.length === 0 && users.length === 0) return true
  if (users.includes(userId)) return true
  if (teams.length === 0) return false
  const myTeams = new Set(teamIdsForUser(conn.workspaceId, userId))
  return teams.some((t) => myTeams.has(t))
}

// Absolute base URL of the frontend, for building invite links.
export const baseUrl = (req) => req.headers.origin || `${req.protocol}://${req.get('host')}`
