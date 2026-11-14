/**
 * Request guards, over Hayat.
 *
 * Tabletsgo keeps no accounts, logins, roles or grants (CLAUDE.md
 * "INVARIANTS"): a request carries a Hayat access token, and every question
 * below is answered by Hayat (server/hayat) — who the caller is, whether they
 * belong to a workspace (a Hayat tenant), and what they may do there.
 *
 * Two tiers, as before:
 *
 *   instance   `instance.manage` granted at Hayat's root — the tabletsgo admin
 *              area (modules, mail, updates). It carries no workspace data access.
 *   workspace  grants on the workspace's tenant node and below, asked about by
 *              permission (`requirePermission(req, res, wsId, 'storage.manage')`),
 *              never by role name.
 *
 * The token is resolved once per request by `sessionMiddleware` and parked on
 * `req`, so `requireAuth` (and `requireSystemAdmin`) stay synchronous reads of
 * it. The workspace-tier guards — `requirePermission`, `requireMember` — are
 * async, because they ask Hayat:
 * `if (!(await requirePermission(req, res, wsId, 'x'))) return`. Forgetting the
 * `await` there is a silent authorization bypass (a Promise is truthy).
 */

import { PUBLIC_URL } from './config.js'
import { CONNECTION_TYPE, TENANT_TYPE, hayatKey, shortKeys } from './permissions-catalog.js'
import * as hayat from './hayat/index.js'

export const bearerToken = (req) => {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

const ROOT = hayat.nodeRef(hayat.ROOT_NODE_ID)

/**
 * Resolve the caller once per request, before any route runs. A bad token, an
 * account that isn't active, or Hayat being unreachable all mean "not signed
 * in" (401 from the guards), never a 500.
 */
export async function sessionMiddleware(req, _res, next) {
  const token = bearerToken(req)
  if (token) {
    try {
      const { userId } = await hayat.verifyAccessToken(token)
      const user = await hayat.getUser(userId)
      if (user && user.status === 'active') {
        const admin = await hayat.check(user.id, hayatKey('instance.manage'), ROOT)
        req.authUser = { ...user, role: admin ? 'admin' : 'user' }
        req.authToken = token
      }
    } catch (error) {
      if (!/expired|signature|JWS|JWT|another application|service token/i.test(error.message)) {
        console.error('Session lookup failed:', error.message)
      }
    }
  }
  next()
}

// The caller (null if unauthenticated).
export const authUser = (req) => req.authUser || null

// Public shape returned to the client.
export const publicUser = (u) =>
  u ? { id: u.id, email: u.email || u.username, name: u.name, role: u.role || 'user', timezone: u.timezone || null, picture: u.picture || null } : null

// Require an authenticated caller; sends 401 and returns null otherwise.
export const requireAuth = (req, res) => {
  const user = authUser(req)
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
  return user
}

// ---- Instance tier ----
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

// ---- Workspace tier ----

/** The workspace (Hayat tenant) as this user sees it, or null if they don't belong. */
export const tenantFor = async (workspaceId, userId) =>
  workspaceId && userId ? (await hayat.userTenants(userId)).find((t) => t.id === workspaceId) || null : null

/**
 * Do they belong? Membership is the tenant's roster in Hayat. It still gates
 * *data*: a member sees every connection in the workspace; opening one is the
 * `connection.open` permission.
 */
export const isMember = async (workspaceId, userId) => !!(await tenantFor(workspaceId, userId))

/**
 * Everything the caller may do in this workspace, as short keys. The tenant's
 * owner resolves to every key there is, including the instance-wide one, which
 * means nothing at a workspace (admin is only ever asked at the root), so it is
 * left out rather than shown as something the workspace grants.
 */
export const permissionsIn = async (workspaceId, userId) => {
  if (!workspaceId) return new Set()
  const keys = shortKeys(await hayat.permissionsAt(userId, hayat.ref(TENANT_TYPE, workspaceId)))
  keys.delete('instance.manage')
  return keys
}

// The permission check. `workspaceId` null/undefined ⇒ false, so a resource with
// no workspace never accidentally authorizes anyone.
export const can = async (workspaceId, userId, permission) => (await permissionsIn(workspaceId, userId)).has(permission)

/** Everything the caller may do at one connection (grants on it and above, ownership). */
export const permissionsAtConnection = async (connectionId, userId) =>
  shortKeys(await hayat.permissionsAt(userId, hayat.ref(CONNECTION_TYPE, connectionId)))

/**
 * The workspace-tier guard. A route asks for the capability it needs and never
 * compares a role name. The 403 distinguishes "you're in this workspace but may
 * not do this" from "you're not in this workspace at all".
 */
export const requirePermission = async (req, res, workspaceId, permission) => {
  const user = requireAuth(req, res)
  if (!user) return null
  if (!(await permissionsIn(workspaceId, user.id)).has(permission)) {
    const inside = await isMember(workspaceId, user.id)
    res.status(403).json({ error: inside ? 'You do not have permission to do that.' : 'Forbidden', permission })
    return null
  }
  return user
}

// Guard for anything any member of the workspace may do.
export const requireMember = async (req, res, workspaceId) => {
  const user = requireAuth(req, res)
  if (!user) return null
  if (!(await isMember(workspaceId, user.id))) {
    res.status(403).json({ error: 'Forbidden' })
    return null
  }
  return user
}

/**
 * The workspace as this user sees it. `permissions` ships with it so the client
 * can hide what the caller can't do — the server still enforces every one.
 * `role` is only a label now: 'owner' for the tenant's owner in Hayat.
 */
export const workspaceForUser = async (id, userId) => {
  const t = await tenantFor(id, userId)
  if (!t) return null
  return {
    id: t.id,
    name: t.name,
    role: t.ownerId === userId ? 'owner' : 'member',
    permissions: [...(await permissionsIn(id, userId))],
    memberCount: t.memberCount,
  }
}

// ---- Connections ----

/**
 * Can this user open the connection? One question to Hayat:
 * `tabletsgo.connection.open` at the connection's node. Hayat's rule covers what
 * this function used to spell out — owning it, a grant on it or above (the
 * `owner` and `connection-manager` roles carry it), sitting on the roster of a
 * group it is filed under — and refuses anyone not on the workspace's roster.
 * Nothing granted means nobody, not everybody.
 */
export const userCanAccessConnection = async (conn, userId) => {
  if (!conn) return false
  if (!conn.workspaceId) return true
  return hayat.check(userId, hayatKey('connection.open'), hayat.ref(CONNECTION_TYPE, conn.id))
}

/** May they change the connection record? Own it, or hold `connections.manage` at it. */
export const canManageConnection = async (conn, userId) =>
  !conn.workspaceId || conn.ownerId === userId || (await permissionsAtConnection(conn.id, userId)).has('connections.manage')

// Absolute base URL of the frontend, for links in emails.
// `PUBLIC_URL` when set; the request can't be trusted to name the instance behind
// a proxy, and on a public route it is whatever the sender says.
export const baseUrl = (req) => PUBLIC_URL || req.headers.origin || `${req.protocol}://${req.get('host')}`
