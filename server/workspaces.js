/**
 * Workspaces and their membership — the org/tenant layer.
 *
 * Owns `workspaces`, `workspace_members` and the teams rows that hang off a
 * workspace, so no route writes raw SQL against them. Two callers use this:
 * the workspace routes (an *owner* managing their own workspace) and the admin
 * routes (an *instance admin* managing every workspace's existence and who owns
 * it). See CLAUDE.md "AUTH MODEL" for the two-tier role split.
 */

import { randomUUID } from 'crypto'
import { meta } from './meta.js'
import { deleteConnectionRow } from './connections.js'
import { OWNER_PERMISSION, ownerRoleSlugs, permissionsForRole, roleHasPermission } from './permissions.js'

/**
 * A membership's role is a slug from the `roles` table, so "is this an owner?"
 * is a question about permissions, not about a name: anyone holding
 * `workspace.manage` counts. That is what makes the last-owner invariant hold no
 * matter how an instance admin has redefined the roles.
 */
export const isOwnerRole = (role) => roleHasPermission(role, OWNER_PERMISSION)

export const getWorkspaceRow = (id) => meta.prepare('SELECT id, name, settings, created_at FROM workspaces WHERE id = ?').get(id) || null

// Every workspace on the instance, with counts and its owners — the admin list.
export const listAllWorkspaces = () =>
  meta
    .prepare(
      `SELECT w.id, w.name, w.created_at,
              (SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id = w.id) AS memberCount,
              (SELECT COUNT(*) FROM teams t WHERE t.workspace_id = w.id) AS teamCount
         FROM workspaces w ORDER BY w.created_at`
    )
    .all()
    .map((w) => ({
      id: w.id,
      name: w.name,
      createdAt: w.created_at,
      memberCount: w.memberCount,
      teamCount: w.teamCount,
      connectionCount: meta.prepare('SELECT COUNT(*) c FROM connections WHERE workspace_id = ?').get(w.id).c,
      owners: listWorkspaceMembers(w.id).filter((m) => m.isOwner),
    }))

/**
 * A workspace's members. Each carries the permissions their role grants, so the
 * client renders "what can this person do" without a second request and without
 * knowing what any given role means.
 */
export const listWorkspaceMembers = (workspaceId) =>
  meta
    .prepare(
      `SELECT u.id AS userId, u.username AS email, u.name, u.status, u.role AS systemRole, m.role, m.created_at AS createdAt
         FROM workspace_members m JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = ? ORDER BY m.created_at`
    )
    .all(workspaceId)
    .map((m) => {
      const role = m.role === 'admin' ? 'owner' : m.role
      return { ...m, role, permissions: [...permissionsForRole(role)], isOwner: isOwnerRole(role) }
    })

/**
 * Members who can manage this workspace. Built from the role slugs that actually
 * carry `workspace.manage` rather than a hardcoded list, so demoting the last one
 * is still refused after an admin invents a role that grants it.
 */
export const countOwners = (workspaceId) => {
  const slugs = ownerRoleSlugs()
  if (!slugs.length) return 0
  const placeholders = slugs.map(() => '?').join(', ')
  return meta.prepare(`SELECT COUNT(*) c FROM workspace_members WHERE workspace_id = ? AND role IN (${placeholders})`).get(workspaceId, ...slugs).c
}

export const createWorkspace = (name, { ownerId } = {}) => {
  const id = randomUUID()
  const now = Date.now()
  meta.transaction(() => {
    meta.prepare('INSERT INTO workspaces (id, name, settings, created_at) VALUES (?, ?, ?, ?)').run(id, name, '{}', now)
    if (ownerId) addMember(id, ownerId, 'owner')
  })()
  return { id, name, createdAt: now }
}

export const renameWorkspace = (id, name) => meta.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, id)

export const addMember = (workspaceId, userId, role = 'member') =>
  meta
    .prepare('INSERT OR IGNORE INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), workspaceId, userId, role, Date.now())

export const setMemberRole = (workspaceId, userId, role) =>
  meta.prepare('UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?').run(role, workspaceId, userId)

/**
 * Drop a membership and everything it granted inside this workspace — team
 * seats and any individual connection grants. Leaving those behind would keep
 * handing access to someone who is no longer a member.
 */
export const removeMember = (workspaceId, userId) => {
  meta.transaction(() => {
    meta.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').run(workspaceId, userId)
    meta
      .prepare('DELETE FROM team_members WHERE user_id = ? AND team_id IN (SELECT id FROM teams WHERE workspace_id = ?)')
      .run(userId, workspaceId)
    meta
      .prepare(
        `DELETE FROM connection_access
          WHERE principal_type = 'user' AND principal_id = ?
            AND connection_id IN (SELECT id FROM connections WHERE workspace_id = ?)`
      )
      .run(userId, workspaceId)
  })()
}

// Workspaces this user is the *last* owner of — deleting the account would
// leave them unmanageable, so the admin route refuses until someone else owns them.
export const listUserSoleOwnerships = (userId) =>
  meta
    .prepare('SELECT w.id, w.name, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ?')
    .all(userId)
    .filter((w) => isOwnerRole(w.role) && countOwners(w.id) <= 1)
    .map(({ id, name }) => ({ id, name }))

// Every workspace membership a user holds — used when promoting them to
// instance admin, which must leave them with none.
export const removeAllMemberships = (userId) => {
  for (const { workspace_id: wid } of meta.prepare('SELECT workspace_id FROM workspace_members WHERE user_id = ?').all(userId)) {
    removeMember(wid, userId)
  }
}

/**
 * Delete a workspace and everything scoped to it. Kept here (rather than inline
 * in a route) because two callers need the identical cascade, and it must stay
 * in step with the DELETE /api/connections/:id cascade in server.js.
 */
export const deleteWorkspaceCascade = (workspaceId) => {
  const connectionIds = meta.prepare('SELECT id FROM connections WHERE workspace_id = ?').all(workspaceId).map((r) => r.id)

  meta.transaction(() => {
    for (const id of connectionIds) {
      deleteConnectionRow(id)
      for (const table of [
        'saved_queries',
        'connection_tables',
        'workflows',
        'workflow_runs',
        'dashboards',
        'folders',
        'query_history',
        'connection_access',
        'schema_migrations',
        'backup_schedules',
        'backup_runs',
      ]) {
        meta.prepare(`DELETE FROM ${table} WHERE connection_id = ?`).run(id)
      }
    }
    meta.prepare('DELETE FROM workspace_members WHERE workspace_id = ?').run(workspaceId)
    meta.prepare('DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE workspace_id = ?)').run(workspaceId)
    meta.prepare('DELETE FROM teams WHERE workspace_id = ?').run(workspaceId)
    meta.prepare('DELETE FROM storage_destinations WHERE workspace_id = ?').run(workspaceId)
    meta.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId)
  })()

  return connectionIds
}
