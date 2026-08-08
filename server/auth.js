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
 *   workspace  the grant on the workspace's node — a role *slug* from `roles`
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
import { OWNER_PERMISSION } from './permissions.js'
import { groupIdsFor, isNodeMember, nodeFor, permissionsAtResource, permissionsInWorkspace, principalGrantRole } from './resource-tree.js'

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
export const isMember = (workspaceId, userId) => {
  if (!workspaceId || !userId) return false
  const node = nodeFor('workspace', workspaceId)
  return !!node && isNodeMember(node.id, userId)
}

/**
 * The role slug this member holds in this workspace, or null if they aren't one.
 *
 * Belonging and role are now two different facts on the same node: the roster
 * (`node_members`) says who is in the workspace, the grant sitting on that node
 * says what they may do. So this reads the grant, and **`isMember` is what
 * answers "do they belong"** — a member holding no grant is a real state (sees
 * everything, may do nothing) and would read as `null` here.
 */
export const memberRole = (workspaceId, userId) => {
  const node = nodeFor('workspace', workspaceId)
  if (!node || !isNodeMember(node.id, userId)) return null
  const slug = principalGrantRole(node.id, 'user', userId)
  return slug === 'admin' ? 'owner' : slug
}

/**
 * Everything the caller may do in this workspace.
 *
 * Resolved through the resource tree (server/resource-tree.js), not by looking up
 * a role column: the answer is the union of every grant on the workspace's node
 * and its ancestors, plus everything at all if the caller owns one of them. A
 * plain member gets exactly what their membership role always gave — the
 * membership is mirrored into a grant on that node — while a grant made higher up
 * or lower down now counts too, which is the whole point of the tree.
 */
export const permissionsIn = (workspaceId, userId) => (workspaceId ? permissionsInWorkspace(workspaceId, userId) : new Set())

// The permission check. `workspaceId` null/undefined ⇒ false, so a resource with
// no workspace never accidentally authorizes anyone.
export const can = (workspaceId, userId, permission) => permissionsIn(workspaceId, userId).has(permission)

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
  if (!permissionsIn(workspaceId, user.id).has(permission)) {
    // The membership is what distinguishes "you're in this workspace but may not
    // do this" from "you're not in this workspace at all" — the tree can grant
    // someone a permission here without making them a member, and either way the
    // first message is the one that tells them to go ask an owner.
    const inside = isMember(workspaceId, user.id)
    res.status(403).json({ error: inside ? 'You do not have permission to do that.' : 'Forbidden', permission })
    return null
  }
  return user
}

// Guard for anything any member of the workspace may do.
export const requireMember = (req, res, workspaceId) => {
  const user = requireAuth(req, res)
  if (!user) return null
  if (!isMember(workspaceId, user.id)) {
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
  // `role` is still the membership's role — what the members UI shows — but
  // `permissions` is the resolved answer, which may be wider if the tree grants
  // them something above or beside their membership.
  return w ? { id: w.id, name: w.name, role, permissions: [...permissionsIn(id, userId)], createdAt: w.created_at } : null
}

export const getUserByEmail = (email) =>
  meta.prepare('SELECT id, username, name, role, status FROM users WHERE username = ?').get(email)

// ---- Connection-access helpers ----
//
// A connection's access list names the same principals a grant does — a user, or
// a group node standing for its roster. It stays separate from the grant tables
// on purpose: *opening* a database is not a permission (CLAUDE.md), it is a
// per-resource question, so there is no `connections.query`-shaped key.

// Assigned principals for a connection, split into group/user id arrays.
export const connectionAccess = (connectionId) => {
  const rows = meta.prepare('SELECT principal_type, principal_id FROM connection_access WHERE connection_id = ?').all(connectionId)
  return {
    groups: rows.filter((r) => r.principal_type === 'node').map((r) => r.principal_id),
    users: rows.filter((r) => r.principal_type === 'user').map((r) => r.principal_id),
  }
}

// Replace a connection's access list atomically. Empty arrays => open to all members.
export const setConnectionAccess = (connectionId, { groups = [], users = [] }) => {
  const now = Date.now()
  const tx = meta.transaction(() => {
    meta.prepare('DELETE FROM connection_access WHERE connection_id = ?').run(connectionId)
    const ins = meta.prepare('INSERT OR IGNORE INTO connection_access (id, connection_id, principal_type, principal_id, created_at) VALUES (?, ?, ?, ?, ?)')
    for (const g of groups) ins.run(randomUUID(), connectionId, 'node', g, now)
    for (const u of users) ins.run(randomUUID(), connectionId, 'user', u, now)
  })
  tx()
}

// Can this user see/open the connection? Whoever manages every connection in the
// workspace always can, and so does the connection's own owner; an unassigned
// connection is open to every workspace member; otherwise the user must be a
// listed individual or belong to a listed group.
export const userCanAccessConnection = (conn, userId) => {
  if (!conn) return false
  if (!conn.workspaceId) return true
  // Membership gates data access, and deliberately still does after the resource
  // tree took over permissions: an instance admin owns the application node and
  // so resolves to every permission on every connection, but they hold no
  // membership, and instance administration is meant to carry no data access
  // (CLAUDE.md "AUTH MODEL"). Removing this line is what would hand every admin a
  // key to every database.
  if (!isMember(conn.workspaceId, userId)) return false
  // Resolved through the tree, so `connections.manage` granted on this one
  // connection's node opens this one connection — not the whole workspace.
  if (permissionsAtResource('connection', conn.id, userId).has('connections.manage')) return true
  if (conn.ownerId && conn.ownerId === userId) return true
  // An empty list means nobody — not everybody. Seeing a connection and being
  // able to open it are different questions: every member sees every connection
  // in their workspace (their membership grant reaches the whole subtree), and
  // opening one is granted per connection. Meta migration v16 wrote today's
  // implicit "open to all members" down explicitly first, as the workspace node,
  // so no existing connection lost access when the default flipped.
  const { groups, users } = connectionAccess(conn.id)
  if (users.includes(userId)) return true
  if (!groups.length) return false
  // A group principal may be the workspace node itself, which names exactly
  // "everyone in this workspace" — the roster lookup answers both the same way.
  const mine = new Set(groupIdsFor(userId))
  return groups.some((g) => mine.has(g))
}

// Absolute base URL of the frontend, for building invite links.
export const baseUrl = (req) => req.headers.origin || `${req.protocol}://${req.get('host')}`
