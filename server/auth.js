/**
 * Sessions, request guards and the workspace/team membership rules that decide
 * who may see a connection.
 *
 * Roles are per workspace (`admin` | `member`) via `workspace_members`. A login
 * is a bearer token in the session store (server/sessions — in-process by
 * default, Redis when SESSION_REDIS_URL is set), *not* a meta-DB row: replicas
 * then share logins, and the store expires them on its own.
 *
 * The store is async while `requireAuth` is called synchronously by ~100 routes,
 * so the token is resolved once per request by `sessionMiddleware` and parked on
 * `req`. Everything downstream reads that — no route had to change.
 */

import { createAuthSession, destroyAuthSession, readAuthSession } from './sessions/index.js'
import { meta } from './meta.js'

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

// A user is an "instance admin" for update purposes if they're an admin of any
// workspace (updates are instance-wide, not scoped to one workspace).
export const isAnyWorkspaceAdmin = (userId) =>
  !!meta.prepare("SELECT 1 FROM workspace_members WHERE user_id = ? AND role = 'admin' LIMIT 1").get(userId)

export const requireSystemAdmin = (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return null
  if (!isAnyWorkspaceAdmin(user.id)) {
    res.status(403).json({ error: 'Admin access required' })
    return null
  }
  return user
}

// ---- Workspace helpers ----
export const memberRole = (workspaceId, userId) => {
  const m = meta.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, userId)
  return m ? m.role : null
}

export const workspaceForUser = (id, userId) => {
  const role = memberRole(id, userId)
  if (!role) return null
  const w = meta.prepare('SELECT id, name, created_at FROM workspaces WHERE id = ?').get(id)
  return w ? { id: w.id, name: w.name, role, createdAt: w.created_at } : null
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

// Can this user see/open the connection? Admins always can; an unassigned
// connection is open to every workspace member; otherwise the user must be a
// listed individual or belong to a listed team.
export const userCanAccessConnection = (conn, userId) => {
  if (!conn) return false
  if (!conn.workspaceId) return true
  const role = memberRole(conn.workspaceId, userId)
  if (!role) return false
  if (role === 'admin') return true
  const { teams, users } = connectionAccess(conn.id)
  if (teams.length === 0 && users.length === 0) return true
  if (users.includes(userId)) return true
  if (teams.length === 0) return false
  const myTeams = new Set(teamIdsForUser(conn.workspaceId, userId))
  return teams.some((t) => myTeams.has(t))
}

// Absolute base URL of the frontend, for building invite links.
export const baseUrl = (req) => req.headers.origin || `${req.protocol}://${req.get('host')}`
