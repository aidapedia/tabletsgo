/**
 * What tabletsgo keeps about a workspace — its settings — and the cascade that
 * removes everything tabletsgo holds for one.
 *
 * The workspace itself is a Hayat tenant: Hayat owns its existence, its name,
 * its roster and its owner, and tabletsgo never creates, renames or deletes one.
 * Owns `workspaces`, a per-tenant row of tabletsgo's own settings (experiments,
 * notifications, session policy). The `name` column is a cache of Hayat's,
 * refreshed whenever a member lists their workspaces, for the places that name a
 * workspace without a person to ask on behalf of (the admin's module notices).
 */

import { db, transaction } from './meta.js'
import { deleteConnectionMetadata } from './connections.js'
import * as hayat from './hayat/index.js'
import { CONNECTION_TYPE, GROUP_TYPE, STORAGE_TYPE, TENANT_TYPE, shortKeys } from './permissions-catalog.js'

export const getWorkspaceRow = async (id) =>
  (id ? await db().workspaces.findUnique({ where: { id }, select: { id: true, name: true, settings: true, created_at: true } }) : null) || null

/** Keep each tenant's cached name current; make the row the first time we see it. */
export async function syncWorkspaceRows(tenants) {
  if (!tenants.length) return
  const rows = await db().workspaces.findMany({ where: { id: { in: tenants.map((t) => t.id) } }, select: { id: true, name: true } })
  const known = new Map(rows.map((r) => [r.id, r.name]))
  for (const t of tenants) {
    if (!known.has(t.id)) await db().workspaces.create({ data: { id: t.id, name: t.name, settings: '{}', created_at: Date.now() } })
    else if (known.get(t.id) !== t.name) await db().workspaces.update({ where: { id: t.id }, data: { name: t.name } })
  }
}

/** Replace a workspace's settings blob, making its row if it has none yet. */
export const saveWorkspaceSettings = (id, name, settings) =>
  db().workspaces.upsert({
    where: { id },
    create: { id, name: name || id, settings: JSON.stringify(settings), created_at: Date.now() },
    update: { settings: JSON.stringify(settings) },
  })

/**
 * Delete everything tabletsgo holds for a workspace. The tenant stays in Hayat —
 * removing it is Hayat's call, and Hayat refuses while anything is filed under
 * it, which is why the caller deletes our mirrors there first.
 */
export const deleteWorkspaceCascade = async (workspaceId) =>
  transaction(async () => {
    const connectionIds = (await db().connections.findMany({ where: { workspace_id: workspaceId }, select: { id: true } })).map((r) => r.id)
    for (const id of connectionIds) {
      await deleteConnectionMetadata(id)
    }
    await db().storage_destinations.deleteMany({ where: { workspace_id: workspaceId } })
    // SSH hosts and keys hang off the workspace too, and a key row holds a sealed
    // private key — nothing else would ever remove it.
    await db().ssh_gateways.deleteMany({ where: { workspace_id: workspaceId } })
    await db().ssh_keys.deleteMany({ where: { workspace_id: workspaceId } })
    // Standalone schema drafts hang off the workspace, not a connection, so the
    // per-connection loop above never reaches them.
    await db().schema_drafts.deleteMany({ where: { workspace_id: workspaceId } })
    await db().workspaces.deleteMany({ where: { id: workspaceId } })
    return connectionIds
  })

// ---- Members ----
// The roster and what each person was given are Hayat's; these shape them for
// the Member pages. Read-only: people and grants change in Hayat's console.

const ACCESS_KIND = { [TENANT_TYPE]: 'workspace', [GROUP_TYPE]: 'group', [CONNECTION_TYPE]: 'connection', [STORAGE_TYPE]: 'storage' }

/** One grant (or owned node) as the Access list shows it. */
const accessEntry = (g) => {
  const ownNode = g.resource.type === TENANT_TYPE || g.resource.type === GROUP_TYPE
  return {
    kind: ACCESS_KIND[g.resource.type] || g.resource.type,
    // tabletsgo's own resources by their tabletsgo id (a link target); the
    // workspace and groups by their Hayat node.
    id: ownNode ? g.resource.nodeId : g.resource.externalId,
    name: g.resource.name,
    via: g.via,
    role: g.role,
    roleName: g.roleName,
    inherit: g.inherit,
    groupName: g.groupName,
  }
}

/** The roles someone holds on the workspace itself, once each. */
const workspaceRoles = (grants) => {
  const seen = new Map()
  for (const g of grants) {
    if (g.resource.type !== TENANT_TYPE || g.via === 'owner' || seen.has(g.role)) continue
    seen.set(g.role, { role: g.role, name: g.roleName, via: g.via, groupName: g.groupName })
  }
  return [...seen.values()]
}

const memberView = async (workspaceId, m, grants) => ({
  userId: m.user.id,
  email: m.user.email,
  name: m.user.name,
  status: m.user.status,
  role: m.isOwner ? 'owner' : 'member',
  isOwner: m.isOwner,
  createdAt: m.joinedAt,
  roles: workspaceRoles(grants),
  permissions: [...shortKeys(await hayat.permissionsAt(m.user.id, hayat.ref(TENANT_TYPE, workspaceId)))].filter((k) => k !== 'instance.manage'),
})

/** A workspace's members, each with their workspace roles and what they may do there. */
export async function listWorkspaceMembers(workspaceId) {
  const [roster, grants] = await Promise.all([hayat.tenantMembers(workspaceId), hayat.tenantGrants(workspaceId)])
  return Promise.all(roster.map((m) => memberView(workspaceId, m, grants.filter((g) => g.userId === m.user.id))))
}

/** One member and their Access list — every grant that reaches them and what they own. Null if not on the roster. */
export async function getWorkspaceMember(workspaceId, userId) {
  const [roster, grants] = await Promise.all([hayat.tenantMembers(workspaceId), hayat.tenantGrants(workspaceId)])
  const m = roster.find((x) => x.user.id === userId)
  if (!m) return null
  const mine = grants.filter((g) => g.userId === userId)
  return { ...(await memberView(workspaceId, m, mine)), access: mine.map(accessEntry) }
}
