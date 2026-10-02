/**
 * Workspaces and their membership — the org/tenant layer.
 *
 * Owns `workspaces`, so no route writes raw SQL against it. Membership itself
 * lives in `node_members` on the workspace's own node — a workspace is a group
 * like any other, so it has one roster in the one roster table (meta migration
 * v16); this module is where that is read and written for a workspace. Two
 * callers use this:
 * the workspace routes (an *owner* managing their own workspace) and the admin
 * routes (an *instance admin* managing every workspace's existence and who owns
 * it). See CLAUDE.md "AUTH MODEL" for the two-tier role split.
 */

import { randomUUID } from 'crypto'
import { db, transaction } from './meta.js'
import { deleteConnectionMetadata } from './connections.js'
import { OWNER_PERMISSION, ownerRoleSlugs, permissionsForRole, roleHasPermission } from './permissions.js'
import {
  addNodeMember,
  clearMembershipsIn,
  clearOwnerIn,
  createResourceNode,
  deleteResourceNode,
  nodeFor,
  renameResourceNode,
  revokePrincipalIn,
  setNodeOwner,
  setPrincipalGrant,
} from './resource-tree.js'

/**
 * A membership and its grant on the workspace's tree node say the same thing, and
 * this is the only place that keeps them saying it.
 *
 * Belonging and role are two facts on the same node: the roster (`node_members`)
 * says who is in the workspace — which is what gates data access, and what makes
 * every resource in it visible to them — while the grant on that node says what
 * they may do. A member holding no grant is a real state: sees everything, may do
 * nothing. Writing both here, in one function per change, is what stops them from
 * drifting: no route touches either directly.
 */
const syncMemberGrant = async (workspaceId, userId, role) => {
  const node = await nodeFor('workspace', workspaceId)
  if (!node) return
  await setPrincipalGrant(node.id, 'user', userId, role, { inherit: true })
  // A workspace whose node has no owner is a workspace where "the owner can do
  // anything under this node" means nothing, so the first person to hold
  // `workspace.manage` claims it. Later owners don't take it over — transferring
  // it is a deliberate act (PUT /api/resource-tree/:id/owner).
  if (!node.ownerId && isOwnerRole(role)) await setNodeOwner(node.id, userId)
}

/**
 * A membership's role is a slug from the `roles` table, so "is this an owner?"
 * is a question about permissions, not about a name: anyone holding
 * `workspace.manage` counts. That is what makes the last-owner invariant hold no
 * matter how an instance admin has redefined the roles.
 */
export const isOwnerRole = (role) => roleHasPermission(role, OWNER_PERMISSION)

/**
 * Every workspace this user belongs to, with the role their grant carries.
 *
 * The one join that turns "a roster row on a workspace node" back into "a
 * membership", exported so no other module re-derives it. `role` is null for a
 * member holding no grant — they belong, and may do nothing.
 */
export const membershipsOf = async (userId) =>
  (
    await db().$queryRaw`
      SELECT w.id, w.name, w.created_at, w.settings, g.role_slug AS role
        FROM node_members nm
        JOIN resource_nodes n ON n.id = nm.node_id AND n.type = 'workspace'
        JOIN workspaces w ON w.id = n.resource_id
        LEFT JOIN resource_grants g
          ON g.node_id = n.id AND g.principal_type = 'user' AND g.principal_id = nm.user_id
       WHERE nm.user_id = ${userId} ORDER BY w.created_at`
  ).map((r) => ({ ...r, role: r.role === 'admin' ? 'owner' : r.role }))

export const getWorkspaceRow = async (id) =>
  (id ? await db().workspaces.findUnique({ where: { id }, select: { id: true, name: true, settings: true, created_at: true } }) : null) || null

// Every workspace on the instance, with counts and its owners — the admin list.
// (Aliases are snake_case: PostgreSQL folds unquoted ones to lower case.)
export const listAllWorkspaces = async () => {
  const rows = await db().$queryRaw`
    SELECT w.id, w.name, w.created_at,
           (SELECT COUNT(*) FROM node_members nm
              JOIN resource_nodes n ON n.id = nm.node_id
             WHERE n.type = 'workspace' AND n.resource_id = w.id) AS member_count,
           (SELECT COUNT(*) FROM resource_nodes n
             WHERE n.workspace_id = w.id AND n.type = 'group') AS group_count,
           (SELECT COUNT(*) FROM connections c WHERE c.workspace_id = w.id) AS connection_count
      FROM workspaces w ORDER BY w.created_at`
  return Promise.all(
    rows.map(async (w) => ({
      id: w.id,
      name: w.name,
      createdAt: w.created_at,
      memberCount: w.member_count,
      groupCount: w.group_count,
      connectionCount: w.connection_count,
      owners: (await listWorkspaceMembers(w.id)).filter((m) => m.isOwner),
    }))
  )
}

/**
 * A workspace's members. Each carries the permissions their role grants, so the
 * client renders "what can this person do" without a second request and without
 * knowing what any given role means.
 */
export const listWorkspaceMembers = async (workspaceId) => {
  const node = await nodeFor('workspace', workspaceId)
  if (!node) return []
  const rows = await db().$queryRaw`
    SELECT u.id AS user_id, u.username AS email, u.name, u.status, u.role AS system_role,
           g.role_slug AS role, nm.created_at
      FROM node_members nm
      JOIN users u ON u.id = nm.user_id
      LEFT JOIN resource_grants g
        ON g.node_id = nm.node_id AND g.principal_type = 'user' AND g.principal_id = nm.user_id
     WHERE nm.node_id = ${node.id} ORDER BY nm.created_at`
  return rows.map((m) => {
    const role = m.role === 'admin' ? 'owner' : m.role
    return {
      userId: m.user_id,
      email: m.email,
      name: m.name,
      status: m.status,
      systemRole: m.system_role,
      role,
      createdAt: m.created_at,
      permissions: role ? [...permissionsForRole(role)] : [],
      isOwner: !!role && isOwnerRole(role),
    }
  })
}

/**
 * Members who can manage this workspace. Built from the role slugs that actually
 * carry `workspace.manage` rather than a hardcoded list, so demoting the last one
 * is still refused after an admin invents a role that grants it.
 */
export const countOwners = async (workspaceId) => {
  const slugs = ownerRoleSlugs()
  const node = await nodeFor('workspace', workspaceId)
  if (!slugs.length || !node) return 0
  // On the roster *and* holding a grant that carries it — belonging alone is not
  // owning, now that the two are separate facts.
  const [roster, grants] = await Promise.all([
    db().node_members.findMany({ where: { node_id: node.id }, select: { user_id: true } }),
    db().resource_grants.findMany({
      where: { node_id: node.id, principal_type: 'user', role_slug: { in: slugs } },
      select: { principal_id: true },
    }),
  ])
  const onRoster = new Set(roster.map((r) => r.user_id))
  return grants.filter((g) => onRoster.has(g.principal_id)).length
}

/**
 * Create a workspace, its group node under the application root, and its first
 * membership — in that order, because the membership's grant needs the node to
 * exist. The workspace's node is owned by its first owner, which is what makes
 * "the owner can do anything under this node" true from the first request.
 */
export const createWorkspace = async (name, { ownerId } = {}) => {
  const id = randomUUID()
  const now = Date.now()
  await transaction(async () => {
    await db().workspaces.create({ data: { id, name, settings: '{}', created_at: now } })
    await createResourceNode('workspace', id, { name, ownerId: ownerId || null, workspaceId: id })
    if (ownerId) await addMember(id, ownerId, 'owner')
  })
  return { id, name, createdAt: now }
}

export const renameWorkspace = async (id, name) =>
  transaction(async () => {
    await db().workspaces.update({ where: { id }, data: { name } })
    await renameResourceNode('workspace', id, name)
  })

export const addMember = async (workspaceId, userId, role = 'member') =>
  transaction(async () => {
    const node = await nodeFor('workspace', workspaceId)
    if (!node) return
    // Roster first, grant second — `addGrant` refuses a user who isn't a member of
    // the workspace, so the order is load-bearing, not stylistic.
    await addNodeMember(node.id, userId)
    await syncMemberGrant(workspaceId, userId, role)
  })

export const setMemberRole = async (workspaceId, userId, role) => {
  // The role *is* the grant now, so there is nothing else to update.
  await syncMemberGrant(workspaceId, userId, role)
}

/**
 * Drop a membership and everything it granted inside this workspace — group
 * seats and any individual connection grants. Leaving those behind would keep
 * handing access to someone who is no longer a member.
 */
export const removeMember = async (workspaceId, userId) => {
  const node = await nodeFor('workspace', workspaceId)
  await transaction(async () => {
    // Every group seat they held inside this workspace — including the workspace
    // node's own roster, which is the membership itself. A seat is what a grant
    // made elsewhere reaches through, so leaving one behind would keep handing
    // access to someone who is no longer a member.
    await clearMembershipsIn(node, userId)
    const connections = await db().connections.findMany({ where: { workspace_id: workspaceId }, select: { id: true } })
    await db().connection_access.deleteMany({
      where: { principal_type: 'user', principal_id: userId, connection_id: { in: connections.map((c) => c.id) } },
    })
    // Every grant they held anywhere in this workspace's subtree, not only the
    // one mirroring the membership — a grant left on a single connection would
    // keep handing access to someone who is no longer a member.
    await revokePrincipalIn(node, 'user', userId)
    // Ownership of a node inside the workspace goes with them too, or they would
    // still resolve to every permission in that subtree.
    await clearOwnerIn(node, userId)
  })
}

// Workspaces this user is the *last* owner of — deleting the account would
// leave them unmanageable, so the admin route refuses until someone else owns them.
export const listUserSoleOwnerships = async (userId) => {
  const sole = []
  for (const w of await membershipsOf(userId)) {
    if (w.role && isOwnerRole(w.role) && (await countOwners(w.id)) <= 1) sole.push({ id: w.id, name: w.name })
  }
  return sole
}

// Every workspace membership a user holds — used when promoting them to
// instance admin, which must leave them with none.
export const removeAllMemberships = async (userId) => {
  for (const { id } of await membershipsOf(userId)) await removeMember(id, userId)
}

/**
 * Delete a workspace and everything scoped to it. Kept here (rather than inline
 * in a route) because two callers need the identical cascade, and it must stay
 * in step with direct connection deletion through one shared operation.
 */
export const deleteWorkspaceCascade = async (workspaceId) =>
  transaction(async () => {
    const connectionIds = (await db().connections.findMany({ where: { workspace_id: workspaceId }, select: { id: true } })).map((r) => r.id)
    for (const id of connectionIds) {
      await deleteConnectionMetadata(id)
    }
    await db().storage_destinations.deleteMany({ where: { workspace_id: workspaceId } })
    // Standalone schema drafts hang off the workspace, not a connection, so the
    // per-connection loop above never reaches them.
    await db().schema_drafts.deleteMany({ where: { workspace_id: workspaceId } })
    await db().workspaces.deleteMany({ where: { id: workspaceId } })
    // One call takes the workspace's whole subtree — group, connection, dashboard
    // and workflow nodes — with every grant on any of them, every roster
    // (including the workspace's own, which is its membership),
    // and every grant that named one of those groups as its principal.
    await deleteResourceNode('workspace', workspaceId)
    return connectionIds
  })
