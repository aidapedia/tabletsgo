/**
 * The resource tree — one hierarchy of every addressable thing on the instance,
 * and the place a role is granted.
 *
 * ## The shape
 *
 *   Application (root, one per instance)
 *   └── Workspace                     group — mirrors a `workspaces` row
 *       ├── Group                     group — created by hand, mirrors nothing
 *       ├── Storage                   resource
 *       └── Connection                resource
 *           ├── Dashboard             resource
 *           └── Workflow              resource
 *
 * A **group** node holds other nodes and is where you organise and grant. A
 * **resource** node is a thing someone uses. `server/permissions-catalog.js` owns
 * the closed list of types and which may parent which — the tree can't be bent
 * into a shape the resolver was never written for.
 *
 * ## How a permission is answered
 *
 * A grant is `(node, principal, role, inherit)`. Answering "may this user do X
 * here" walks the node's ancestors, root-first, and unions what each grant along
 * the way carries:
 *
 *   - **Ownership short-circuits.** `owner_id` on any ancestor means the user may
 *     do everything in that subtree — that is what "the owner of a node can do
 *     anything under it" means, and it is why the application root's owner is an
 *     instance-wide superuser.
 *   - **`inherit` decides reach.** A grant with `inherit = 1` applies to the whole
 *     subtree; `inherit = 0` applies to that node alone, which is how you give
 *     someone one connection without giving them the workspace.
 *   - **A principal is a user or a group.** A group grant resolves through
 *     `node_members` — the roster of the group node the grant names. Membership is
 *     flat (a group holds users, never other groups), so resolving it is one
 *     indexed read with no closure to walk, which is what keeps this file
 *     synchronous. Nesting a group under another therefore organises resources
 *     and says nothing about who is in it: re-filing a folder must never hand
 *     anyone access.
 *
 * Meta migration v15 folded the old `team` type into `group`: a team was already
 * a node, and it was also the set of people a grant named, so the two collapsed
 * into one thing.
 *
 * `permissionsInWorkspace` is the entry point `server/auth.js` uses, so every
 * `requirePermission(req, res, wsId, 'members.manage')` in the routes now resolves
 * through this file without a single route changing. Memberships still exist and
 * still say who belongs to a workspace; `server/workspaces.js` mirrors each one
 * into a grant on that workspace's node so the two never drift.
 *
 * ## Why the caching looks like this
 *
 * The route guards are synchronous (see server/auth.js — making `requireAuth`
 * async is the one thing that file forbids), so every read here is synchronous
 * too, and resolution results are memoized behind the same policy version
 * `server/permissions.js` bumps. A role edit, a grant or a node move all
 * invalidate; nothing else has to.
 */

import { randomUUID } from 'crypto'
import { meta } from './meta.js'
import {
  CUSTOM_NODE_TYPES,
  NODE_TYPE_KEYS,
  PERMISSION_KEYS,
  ROOT_NODE_TYPE,
  canParent,
  nodeType,
} from './permissions-catalog.js'
import { getRole, permissionsForRole, policyVersion, roleGrantableOn } from './permissions.js'

// Every permission there is — what an owner gets, without enumerating it at each
// call site.
const ALL_PERMISSIONS = () => new Set(PERMISSION_KEYS)

export const ROOT_ID = 'root'

// ---- Public shape ----

// Always null for a missing row, never undefined: callers test the result and a
// mixed vocabulary is how `if (node === null)` quietly stops working.
export const nodeRow = (r) =>
  !r
    ? null
    : {
        id: r.id,
        parentId: r.parent_id || null,
        kind: r.kind,
        type: r.type,
        resourceId: r.resource_id || null,
        name: r.name,
        ownerId: r.owner_id || null,
        workspaceId: r.workspace_id || null,
        path: r.path,
        depth: r.depth,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }

export const grantRow = (r) =>
  !r
    ? null
    : {
        id: r.id,
        nodeId: r.node_id,
        principalType: r.principal_type,
        principalId: r.principal_id,
        principalName: r.principal_name || null,
        principalEmail: r.principal_email || null,
        roleSlug: r.role_slug,
        inherit: !!r.inherit,
        createdAt: r.created_at,
      }

// ---- Reads ----

export const getNode = (id) => nodeRow(meta.prepare('SELECT * FROM resource_nodes WHERE id = ?').get(id))

/** The node mirroring a given resource row, e.g. `nodeFor('workspace', wsId)`. */
export const nodeFor = (type, resourceId) =>
  resourceId ? nodeRow(meta.prepare('SELECT * FROM resource_nodes WHERE type = ? AND resource_id = ?').get(type, resourceId)) : null

export const applicationRoot = () => nodeRow(meta.prepare('SELECT * FROM resource_nodes WHERE type = ? LIMIT 1').get(ROOT_NODE_TYPE))

export const childrenOf = (nodeId) =>
  meta.prepare('SELECT * FROM resource_nodes WHERE parent_id = ? ORDER BY kind DESC, sort ASC, name ASC').all(nodeId).map(nodeRow)

/**
 * The node's ancestors, root-first, ending with the node itself.
 *
 * Read straight off the materialized `path` ('/root/<id>/<id>') — one query with
 * ids in hand, rather than a parent-chasing loop that costs one query per level
 * on the hot permission path.
 */
export const chainOf = (node) => {
  if (!node) return []
  const ids = node.path.split('/').filter(Boolean)
  if (!ids.length) return [node]
  const rows = meta.prepare(`SELECT * FROM resource_nodes WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(nodeRow)
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids.map((id) => byId.get(id)).filter(Boolean)
}

/** Every node at or below `node`, including it. One indexed prefix match. */
export const subtreeOf = (node) =>
  node
    ? meta
        .prepare('SELECT * FROM resource_nodes WHERE id = ? OR path LIKE ? ORDER BY depth ASC, sort ASC, name ASC')
        .all(node.id, `${node.path}/%`)
        .map(nodeRow)
    : []

/**
 * The group nodes this user is a member of.
 *
 * No workspace narrowing, and none needed: a grant names one concrete node, and
 * `addGrant` already refuses to point a grant at a group from another workspace.
 * Membership is deliberately flat — a group holds users, never other groups — so
 * this is one indexed read with no closure to walk and no cycle to guard against,
 * which is what keeps the whole resolver synchronous.
 */
// Membership lives on the workspace's own node — it is a group like any other.
// Inlined rather than imported from auth.js, which depends on this module.
const isWorkspaceMember = (workspaceId, userId) => {
  const node = nodeFor('workspace', workspaceId)
  return !!node && !!meta.prepare('SELECT 1 FROM node_members WHERE node_id = ? AND user_id = ?').get(node.id, userId)
}

export const groupIdsFor = (userId) =>
  userId ? meta.prepare('SELECT node_id id FROM node_members WHERE user_id = ?').all(userId).map((r) => r.id) : []

// ---- Resolution ----

// Memoized per (node, user), keyed on the policy version so a role edit, a grant
// or a node move drops every stale answer at once.
let resolveCache = new Map()
let resolveCacheVersion = -1

const memo = (key, compute) => {
  const version = policyVersion()
  if (version !== resolveCacheVersion) {
    resolveCache = new Map()
    resolveCacheVersion = version
  }
  if (resolveCache.has(key)) return resolveCache.get(key)
  const value = compute()
  resolveCache.set(key, value)
  return value
}

/** Drop memoized answers — call after any write that changes the tree. */
export const invalidateResolution = () => {
  resolveCache = new Map()
  resolveCacheVersion = -1
}

/**
 * Everything `userId` may do at `node`, as a Set of permission keys.
 *
 * Root-first walk. An owned ancestor short-circuits to every permission; an
 * ancestor's grant counts only when it inherits, while a grant on the node itself
 * always counts.
 */
export const permissionsAtNode = (node, userId) => {
  if (!node || !userId) return new Set()
  return memo(`p:${node.id}:${userId}`, () => {
    const chain = chainOf(node)
    if (!chain.length) return new Set()

    const groups = new Set(groupIdsFor(userId))
    const ids = chain.map((n) => n.id)
    const grants = meta
      .prepare(`SELECT * FROM resource_grants WHERE node_id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids)

    const out = new Set()
    for (const ancestor of chain) {
      // The owner of a node can do anything under it — including at the root,
      // where that means the whole instance.
      if (ancestor.ownerId === userId) return ALL_PERMISSIONS()

      const here = ancestor.id === node.id
      for (const g of grants) {
        if (g.node_id !== ancestor.id) continue
        if (!here && !g.inherit) continue
        const mine = g.principal_type === 'user' ? g.principal_id === userId : groups.has(g.principal_id)
        if (!mine) continue
        for (const p of permissionsForRole(g.role_slug)) out.add(p)
      }
    }
    return out
  })
}

/**
 * The entry point `server/auth.js` uses. A workspace's permissions are the
 * permissions at its node, so a grant made higher up (on the application root)
 * reaches every workspace, exactly as the tree promises.
 */
export const permissionsInWorkspace = (workspaceId, userId) => permissionsAtNode(nodeFor('workspace', workspaceId), userId)

/** Permissions at the node mirroring a resource, e.g. one connection. */
export const permissionsAtResource = (type, resourceId, userId) => permissionsAtNode(nodeFor(type, resourceId), userId)

/** True when the user owns this node or any ancestor of it. */
export const ownsNode = (node, userId) => {
  if (!node || !userId) return false
  return chainOf(node).some((n) => n.ownerId === userId)
}

/**
 * The tree as this user sees it, flat — the frontend nests it.
 *
 * An **instance admin** sees everything: they hold the application node, which is
 * the whole point of a root. Everyone else sees the nodes they have a reason to
 * see — the ones they own or hold a grant on, everything beneath those, and the
 * ancestors in between so the tree still has a path back to the root. Ancestors
 * included only for context are marked `context: true`, so the UI can render them
 * as scaffolding rather than as something the user can act on.
 */
export const visibleTree = (user) => {
  if (!user) return []

  const decorate = (n, context) => ({ ...n, context })

  if (user.role === 'admin') {
    return meta
      .prepare('SELECT * FROM resource_nodes ORDER BY depth ASC, kind DESC, sort ASC, name ASC')
      .all()
      .map((r) => decorate(nodeRow(r), false))
  }

  const groups = groupIdsFor(user.id)
  const principalRows = groups.length
    ? meta
        .prepare(
          `SELECT * FROM resource_grants
            WHERE (principal_type = 'user' AND principal_id = ?)
               OR (principal_type = 'node' AND principal_id IN (${groups.map(() => '?').join(',')}))`
        )
        .all(user.id, ...groups)
    : meta.prepare("SELECT * FROM resource_grants WHERE principal_type = 'user' AND principal_id = ?").all(user.id)

  const ownedRows = meta.prepare('SELECT * FROM resource_nodes WHERE owner_id = ?').all(user.id).map(nodeRow)

  // Entry points: a node the user owns, or one they hold a grant on.
  const entries = new Map()
  for (const n of ownedRows) entries.set(n.id, { node: n, deep: true })
  for (const g of principalRows) {
    const n = getNode(g.node_id)
    if (!n) continue
    const existing = entries.get(n.id)
    entries.set(n.id, { node: n, deep: (existing?.deep ?? false) || !!g.inherit })
  }
  if (!entries.size) return []

  const visible = new Map()
  for (const { node, deep } of entries.values()) {
    for (const n of deep ? subtreeOf(node) : [node]) visible.set(n.id, decorate(n, false))
  }
  // Ancestors, so every visible node has a path back to the root.
  for (const { node } of entries.values()) {
    for (const a of chainOf(node)) if (!visible.has(a.id)) visible.set(a.id, decorate(a, true))
  }

  return [...visible.values()].sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name))
}

/**
 * Everyone who can reach this node, and **why**.
 *
 * The inverse of `permissionsAtNode`: that answers "what may this one person do
 * here", this answers "who gets in, and through what". It is derived on every
 * call and stored nowhere — the grants and rosters it reads are the only facts.
 *
 * It exists because a node's grant list is not the whole answer. `listGrants`
 * returns what was granted *at* this node, so standing on a connection you
 * cannot see the people reaching it through an inherited grant higher up, the
 * people reaching it because they are in a group that was granted somewhere
 * above, or the owner of an ancestor who short-circuits to everything. Access
 * that the node itself never mentions is exactly what makes a permission model
 * impossible to audit.
 *
 * Each person carries every `source` that lets them in, because two different
 * paths to the same node are two different things to revoke. The source also
 * says where to go to change it: access is still edited where the grant lives,
 * so nothing here becomes a second place a fact is stored. It names the
 * `grantId` behind it so a caller standing on the granting node can revoke
 * without guessing which grant produced the row — a person can hold the same
 * role twice, from two grants, and they are not the same thing to remove.
 *
 * Instance admins are deliberately absent. They administer every node without
 * holding a grant anywhere, and they hold no data access at all (see
 * `userCanAccessConnection`), so listing them as people with access here would
 * be wrong in both directions.
 */
export const peopleAtNode = (node) => {
  if (!node) return []
  const chain = chainOf(node)
  if (!chain.length) return []

  const ids = chain.map((n) => n.id)
  const grants = meta
    .prepare(`SELECT * FROM resource_grants WHERE node_id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids)

  // Reaching grants only: one made here always counts, one made above counts
  // only if it inherits — the same rule the resolver applies.
  const byNode = new Map(chain.map((n) => [n.id, n]))
  const reaching = grants.filter((g) => g.node_id === node.id || g.inherit)

  // Every granted group's roster in one query, rather than one per grant.
  const groupIds = [...new Set(reaching.filter((g) => g.principal_type === 'node').map((g) => g.principal_id))]
  const rosters = new Map(groupIds.map((id) => [id, []]))
  if (groupIds.length) {
    for (const r of meta
      .prepare(`SELECT node_id, user_id FROM node_members WHERE node_id IN (${groupIds.map(() => '?').join(',')})`)
      .all(...groupIds)) {
      rosters.get(r.node_id)?.push(r.user_id)
    }
  }
  const groupName = new Map(
    groupIds.length
      ? meta
          .prepare(`SELECT id, name FROM resource_nodes WHERE id IN (${groupIds.map(() => '?').join(',')})`)
          .all(...groupIds)
          .map((r) => [r.id, r.name])
      : []
  )

  const out = new Map()
  const entry = (userId) => {
    if (!out.has(userId)) out.set(userId, { userId, name: '', email: '', owner: false, permissions: new Set(), sources: [] })
    return out.get(userId)
  }
  const roleName = (slug) => getRole(slug)?.name || slug

  for (const ancestor of chain) {
    // An owner can do anything in their subtree, so they reach every node under
    // it whatever the grants say.
    if (ancestor.ownerId) {
      const person = entry(ancestor.ownerId)
      person.owner = true
      for (const key of ALL_PERMISSIONS()) person.permissions.add(key)
      person.sources.push({
        type: 'owner',
        nodeId: ancestor.id,
        nodeName: ancestor.name,
        instanceWide: !ancestor.workspaceId,
      })
    }
  }

  for (const g of reaching) {
    const via = byNode.get(g.node_id)
    const permissions = permissionsForRole(g.role_slug)
    const add = (userId, source) => {
      const person = entry(userId)
      for (const key of permissions) person.permissions.add(key)
      person.sources.push(source)
    }
    // A grant made above every workspace (on the application root) reaches into
    // this one without its holder being a member of it — the one way the two
    // lists can legitimately differ, so it is marked rather than hidden.
    const instanceWide = !via?.workspaceId
    if (g.principal_type === 'user') {
      add(g.principal_id, {
        type: 'grant',
        grantId: g.id,
        nodeId: g.node_id,
        nodeName: via?.name || '',
        roleSlug: g.role_slug,
        roleName: roleName(g.role_slug),
        here: g.node_id === node.id,
        instanceWide,
      })
    } else if (g.principal_type === 'node') {
      for (const userId of rosters.get(g.principal_id) || []) {
        add(userId, {
          type: 'group',
          grantId: g.id,
          nodeId: g.node_id,
          nodeName: via?.name || '',
          groupId: g.principal_id,
          groupName: groupName.get(g.principal_id) || '',
          roleSlug: g.role_slug,
          roleName: roleName(g.role_slug),
          here: g.node_id === node.id,
          instanceWide,
        })
      }
    }
  }

  if (!out.size) return []
  const userIds = [...out.keys()]
  for (const u of meta
    .prepare(`SELECT id, name, username FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`)
    .all(...userIds)) {
    const person = out.get(u.id)
    person.name = u.name || ''
    person.email = u.username || ''
  }

  // Permissions without membership means permissions without *data* access:
  // `userCanAccessConnection` requires a membership row, so such a person can
  // administer things here and still not open a database. Worth saying out loud
  // wherever this list is rendered.
  const wsNode = node.workspaceId ? nodeFor('workspace', node.workspaceId) : null
  const members = wsNode
    ? new Set(
        meta
          .prepare(`SELECT user_id FROM node_members WHERE node_id = ? AND user_id IN (${userIds.map(() => '?').join(',')})`)
          .all(wsNode.id, ...userIds)
          .map((r) => r.user_id)
      )
    : null

  return [...out.values()]
    // A row whose user no longer exists is a dangling grant, not a person.
    .filter((p) => p.email || p.name)
    .map((p) => ({ ...p, permissions: [...p.permissions].sort(), member: members ? members.has(p.userId) : true }))
    .sort((a, b) => Number(b.owner) - Number(a.owner) || (a.name || a.email).localeCompare(b.name || b.email))
}

// ---- Grants ----

export const listGrants = (nodeId) =>
  meta
    .prepare(
      `SELECT g.*,
              COALESCE(u.name, u.username, gn.name) AS principal_name,
              u.username AS principal_email
         FROM resource_grants g
         LEFT JOIN users u ON g.principal_type = 'user' AND u.id = g.principal_id
         LEFT JOIN resource_nodes gn ON g.principal_type = 'node' AND gn.id = g.principal_id
        WHERE g.node_id = ?
        ORDER BY g.created_at`
    )
    .all(nodeId)
    .map(grantRow)

/**
 * Grant a role on a node.
 *
 * Refuses when the role's requirement criteria don't admit this node type — the
 * check lives in `server/permissions.js` so the same rule answers the editor's
 * "which roles may I pick here" and this write.
 *
 * Returns `{ grant }` or `{ error }`; the route turns the latter into a 400 with
 * the reason, which is always specific enough to act on.
 */
export const addGrant = (nodeId, { principalType, principalId, roleSlug, inherit = true, createdBy = null }) => {
  const node = getNode(nodeId)
  if (!node) return { error: 'Node not found.' }
  if (principalType !== 'user' && principalType !== 'node') return { error: 'A grant is made to a user or a group.' }
  if (!principalId) return { error: 'Who the grant is for is required.' }

  const criteria = roleGrantableOn(roleSlug, node.type)
  if (!criteria.ok) return { error: criteria.reason }

  if (principalType === 'node') {
    // Only a group holds people, and only inside its own workspace: a grant
    // pointing at a group from elsewhere would hand this workspace's permissions
    // to a roster nobody here administers.
    const principal = getNode(principalId)
    if (!principal) return { error: 'Group not found.' }
    if (principal.kind !== 'group') return { error: 'Only a group can be granted a role — it is the thing that holds people.' }
    if (node.workspaceId && principal.workspaceId !== node.workspaceId) {
      return { error: 'That group belongs to a different workspace.' }
    }
  } else {
    if (!meta.prepare('SELECT 1 FROM users WHERE id = ?').get(principalId)) return { error: 'User not found.' }
    // Membership is the authority on who belongs to a workspace, and it is what
    // gates opening a database. Granting a non-member would leave them half in:
    // resolving to permissions through the tree while `memberRole()` returns null,
    // so `requireMember` and `userCanAccessConnection` both still refuse them.
    // The group-roster route and connection-owner transfer already apply this
    // rule; grants were the one path that skipped it. Inlined rather than
    // imported from auth.js, which depends on this module.
    if (node.workspaceId && !isWorkspaceMember(node.workspaceId, principalId)) {
      return { error: 'That person is not a member of this workspace.' }
    }
  }

  const id = randomUUID()
  meta
    .prepare(
      `INSERT INTO resource_grants (id, node_id, principal_type, principal_id, role_slug, inherit, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(node_id, principal_type, principal_id, role_slug)
       DO UPDATE SET inherit = excluded.inherit`
    )
    .run(id, nodeId, principalType, principalId, roleSlug, inherit ? 1 : 0, Date.now(), createdBy)
  invalidateResolution()
  const grant = meta
    .prepare('SELECT * FROM resource_grants WHERE node_id = ? AND principal_type = ? AND principal_id = ? AND role_slug = ?')
    .get(nodeId, principalType, principalId, roleSlug)
  return { grant: grantRow(grant) }
}

export const removeGrant = (grantId) => {
  meta.prepare('DELETE FROM resource_grants WHERE id = ?').run(grantId)
  invalidateResolution()
}

// ---- Membership ----
//
// Who is *inside* a group, which is a different question from what a grant on
// that group's node lets someone do. A grant says "you may do X here"; membership
// decides who a grant made *elsewhere* reaches. Keeping them in separate tables is
// what stops "let Sam tidy this folder" from quietly meaning "put Sam in the team"
// — and a group's roster is therefore governed by `teams.manage`, never by
// `resources.organise`.

/** The people in a group, with enough to render them. */
export const listNodeMembers = (nodeId) =>
  meta
    .prepare(
      `SELECT u.id AS userId, u.username AS email, u.name, m.created_at AS createdAt
         FROM node_members m JOIN users u ON u.id = m.user_id
        WHERE m.node_id = ? ORDER BY m.created_at`
    )
    .all(nodeId)

/** node_id -> roster size, for every group that has one. One query, not one per node. */
export const memberCounts = () => {
  const out = new Map()
  for (const r of meta.prepare('SELECT node_id, COUNT(*) c FROM node_members GROUP BY node_id').all()) out.set(r.node_id, r.c)
  return out
}

/** Group nodes a user belongs to, as node rows — for "where does Sam get this from?". */
export const nodeMembershipsOf = (userId) => {
  const ids = groupIdsFor(userId)
  if (!ids.length) return []
  return meta
    .prepare(`SELECT * FROM resource_nodes WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name`)
    .all(...ids)
    .map(nodeRow)
}

/** Is this person on this node's roster? */
export const isNodeMember = (nodeId, userId) =>
  !!(nodeId && userId && meta.prepare('SELECT 1 FROM node_members WHERE node_id = ? AND user_id = ?').get(nodeId, userId))

/** Just the ids on a node's roster. */
export const nodeMemberIds = (nodeId) =>
  meta.prepare('SELECT user_id FROM node_members WHERE node_id = ?').all(nodeId).map((r) => r.user_id)

/**
 * The role slug a principal was granted directly on one node, or null.
 *
 * This is how a *membership role* is read now that the roster carries no role of
 * its own: belonging is a `node_members` row, and what that person may do is the
 * grant sitting on the same node.
 */
export const principalGrantRole = (nodeId, principalType, principalId) =>
  meta
    .prepare('SELECT role_slug FROM resource_grants WHERE node_id = ? AND principal_type = ? AND principal_id = ? LIMIT 1')
    .get(nodeId, principalType, principalId)?.role_slug || null

export const addNodeMember = (nodeId, userId) => {
  const node = getNode(nodeId)
  if (!node) return { error: 'Group not found.' }
  if (node.kind !== 'group') return { error: 'Only a group holds people.' }
  if (!meta.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) return { error: 'User not found.' }
  meta
    .prepare('INSERT OR IGNORE INTO node_members (id, node_id, user_id, created_at) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), nodeId, userId, Date.now())
  // A roster change is a policy change: the resolver reads membership inside its
  // memo, so without this the new seat stays invisible until something else
  // happens to clear the cache.
  invalidateResolution()
  return { ok: true }
}

export const removeNodeMember = (nodeId, userId) => {
  meta.prepare('DELETE FROM node_members WHERE node_id = ? AND user_id = ?').run(nodeId, userId)
  // Matters more in this direction: a cached answer would keep handing the
  // group's permissions to someone who no longer belongs to it.
  invalidateResolution()
  return { ok: true }
}

/** Drop every group seat a user holds, anywhere. Used by the account cascade. */
export const clearMembershipsFor = (userId) => {
  if (!userId) return
  meta.prepare('DELETE FROM node_members WHERE user_id = ?').run(userId)
  invalidateResolution()
}

/** Drop a user's seats in every group inside one subtree. Used when they leave a workspace. */
export const clearMembershipsIn = (node, userId) => {
  if (!node) return
  meta
    .prepare(
      `DELETE FROM node_members WHERE user_id = ?
        AND node_id IN (SELECT id FROM resource_nodes WHERE id = ? OR path LIKE ?)`
    )
    .run(userId, node.id, `${node.path}/%`)
  invalidateResolution()
}

/**
 * Replace the grant a principal holds on a node, or drop it when `roleSlug` is
 * null. This is what `server/workspaces.js` calls to keep a membership and its
 * workspace-node grant saying the same thing.
 */
export const setPrincipalGrant = (nodeId, principalType, principalId, roleSlug, { inherit = true, createdBy = null } = {}) => {
  meta
    .prepare('DELETE FROM resource_grants WHERE node_id = ? AND principal_type = ? AND principal_id = ?')
    .run(nodeId, principalType, principalId)
  invalidateResolution()
  if (!roleSlug) return { grant: null }
  return addGrant(nodeId, { principalType, principalId, roleSlug, inherit, createdBy })
}

/**
 * Strip a user's ownership of every node in a subtree. Called when they leave the
 * workspace: an owned node resolves to every permission, so leaving the flag set
 * would keep the door open after the membership is gone.
 */
export const clearOwnerIn = (node, userId) => {
  if (!node) return
  meta
    .prepare('UPDATE resource_nodes SET owner_id = NULL, updated_at = ? WHERE owner_id = ? AND (id = ? OR path LIKE ?)')
    .run(Date.now(), userId, node.id, `${node.path}/%`)
  invalidateResolution()
}

/**
 * Strip a user's ownership of every node on the instance.
 *
 * `clearOwnerIn` reaches exactly what losing a *membership* should reach — one
 * workspace's subtree — and `removeAllMemberships` walks every workspace the
 * user belongs to. Deleting the account has to reach further: a node at the
 * application root, or one in a workspace they no longer belong to, sits outside
 * all of those subtrees and would keep an owner id pointing at a user who is
 * gone. An owned node resolves to every permission, so a dangling owner is not
 * merely untidy.
 */
export const clearOwnedNodesEverywhere = (userId) => {
  if (!userId) return
  meta.prepare('UPDATE resource_nodes SET owner_id = NULL, updated_at = ? WHERE owner_id = ?').run(Date.now(), userId)
  invalidateResolution()
}

/** Drop every grant a principal holds anywhere on the instance, for the same reason. */
export const revokePrincipalEverywhere = (principalType, principalId) => {
  if (!principalId) return
  meta.prepare('DELETE FROM resource_grants WHERE principal_type = ? AND principal_id = ?').run(principalType, principalId)
  invalidateResolution()
}

/** Drop every grant a principal holds anywhere in a subtree. */
export const revokePrincipalIn = (node, principalType, principalId) => {
  if (!node) return
  meta
    .prepare(
      `DELETE FROM resource_grants
        WHERE principal_type = ? AND principal_id = ?
          AND node_id IN (SELECT id FROM resource_nodes WHERE id = ? OR path LIKE ?)`
    )
    .run(principalType, principalId, node.id, `${node.path}/%`)
  invalidateResolution()
}

// ---- Node writes ----

const insertNode = ({ parentId, kind, type, resourceId = null, name, ownerId = null, workspaceId = null }) => {
  const parent = parentId ? getNode(parentId) : null
  if (parentId && !parent) return { error: 'Parent node not found.' }
  if (parent && !canParent(parent.type, type)) {
    return { error: `A ${nodeType(parent.type)?.label || parent.type} cannot contain a ${nodeType(type)?.label || type}.` }
  }
  const id = randomUUID()
  const now = Date.now()
  const path = parent ? `${parent.path}/${id}` : `/${id}`
  meta
    .prepare(
      `INSERT INTO resource_nodes (id, parent_id, kind, type, resource_id, name, owner_id, workspace_id, path, depth, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(id, parent?.id || null, kind, type, resourceId, name, ownerId, workspaceId ?? parent?.workspaceId ?? null, path, parent ? parent.depth + 1 : 0, now, now)
  invalidateResolution()
  return { node: getNode(id) }
}

/**
 * Create a group node by hand — the one type a user makes directly (everything
 * else appears because its resource was created).
 */
export const createGroupNode = (parentId, name, { ownerId = null } = {}) => {
  const parent = getNode(parentId)
  if (!parent) return { error: 'Parent node not found.' }
  const clean = String(name || '').trim()
  if (!clean) return { error: 'A name is required.' }
  if (!CUSTOM_NODE_TYPES.length) return { error: 'No group type is available.' }
  return insertNode({ parentId, kind: 'group', type: 'group', name: clean, ownerId, workspaceId: parent.workspaceId })
}

/**
 * Create (or return) the node mirroring a resource row. Called from the hook next
 * to the route that created the resource, so the tree never lags the thing it
 * describes.
 *
 * `parent` is resolved from the resource's own container by default — a
 * connection under its workspace, a dashboard under its connection — but a caller
 * may pass an explicit `parentId` to file it into a custom group instead.
 */
export const createResourceNode = (type, resourceId, { parentId = null, name, ownerId = null, workspaceId = null } = {}) => {
  if (!NODE_TYPE_KEYS.has(type)) return { error: 'Unknown node type.' }
  const existing = nodeFor(type, resourceId)
  if (existing) return { node: existing }

  let parent = parentId ? getNode(parentId) : null
  if (!parent) {
    if (type === 'workspace') parent = applicationRoot()
    else if (workspaceId) parent = nodeFor('workspace', workspaceId)
  }
  if (!parent) return { error: 'No parent node for that resource.' }

  const meta_ = nodeType(type)
  return insertNode({
    parentId: parent.id,
    kind: meta_?.kind || 'resource',
    type,
    resourceId,
    name: String(name || '').trim() || 'Untitled',
    ownerId,
    workspaceId: type === 'workspace' ? resourceId : workspaceId ?? parent.workspaceId,
  })
}

/** Keep a node's name in step with the resource it mirrors. */
export const renameResourceNode = (type, resourceId, name) => {
  meta.prepare('UPDATE resource_nodes SET name = ?, updated_at = ? WHERE type = ? AND resource_id = ?').run(name, Date.now(), type, resourceId)
  invalidateResolution()
}

export const renameNode = (nodeId, name) => {
  const clean = String(name || '').trim()
  if (!clean) return { error: 'A name is required.' }
  meta.prepare('UPDATE resource_nodes SET name = ?, updated_at = ? WHERE id = ?').run(clean, Date.now(), nodeId)
  invalidateResolution()
  return { node: getNode(nodeId) }
}

export const setNodeOwner = (nodeId, userId) => {
  meta.prepare('UPDATE resource_nodes SET owner_id = ?, updated_at = ? WHERE id = ?').run(userId || null, Date.now(), nodeId)
  invalidateResolution()
  return getNode(nodeId)
}

/** Set (or change) who owns the application root — the instance-wide superuser. */
export const setApplicationOwner = (userId) => {
  const root = applicationRoot()
  return root ? setNodeOwner(root.id, userId) : null
}

/**
 * Re-parent a node and every node under it.
 *
 * The subtree's paths are rewritten in one pass — the whole reason the path is
 * materialized. Refuses a move into the node's own subtree, which would detach it
 * from the root and make `chainOf` loop forever.
 */
export const moveNode = (nodeId, newParentId) => {
  const node = getNode(nodeId)
  if (!node) return { error: 'Node not found.' }
  if (!node.parentId) return { error: 'The application root cannot be moved.' }
  const parent = getNode(newParentId)
  if (!parent) return { error: 'Target node not found.' }
  if (parent.id === node.id || parent.path.startsWith(`${node.path}/`)) {
    return { error: 'A node cannot be moved inside itself.' }
  }
  if (!canParent(parent.type, node.type)) {
    return { error: `A ${nodeType(parent.type)?.label || parent.type} cannot contain a ${nodeType(node.type)?.label || node.type}.` }
  }

  const descendants = meta.prepare('SELECT * FROM resource_nodes WHERE path LIKE ?').all(`${node.path}/%`).map(nodeRow)
  const newPath = `${parent.path}/${node.id}`
  const depthShift = parent.depth + 1 - node.depth
  const update = meta.prepare('UPDATE resource_nodes SET path = ?, depth = ?, workspace_id = ?, updated_at = ? WHERE id = ?')
  const now = Date.now()
  meta.transaction(() => {
    meta.prepare('UPDATE resource_nodes SET parent_id = ? WHERE id = ?').run(parent.id, node.id)
    update.run(newPath, parent.depth + 1, parent.workspaceId, now, node.id)
    for (const d of descendants) {
      update.run(d.path.replace(node.path, newPath), d.depth + depthShift, parent.workspaceId, now, d.id)
    }
  })()
  invalidateResolution()
  return { node: getNode(nodeId) }
}

/**
 * Delete a node and everything under it, with every grant on any of them.
 *
 * There is no "move the children up first" mode. A group is deletable only once
 * it is empty (`DELETE /api/resource-tree/:id` refuses otherwise), so re-filing
 * what it held is always something the user did on purpose — which settles by
 * construction what the old reparenting was there to prevent: a resource left
 * with no node, invisible in the tree and unanswerable by the resolver. The
 * remaining callers are resource cascades (a workspace, a connection), where the
 * subtree really is being deleted along with the rows it mirrors.
 */
export const deleteNode = (nodeId) => {
  const node = getNode(nodeId)
  if (!node) return { ok: true }
  if (!node.parentId) return { error: 'The application root cannot be deleted.' }

  const ids = subtreeOf(node).map((n) => n.id)
  meta.transaction(() => {
    const placeholders = ids.map(() => '?').join(',')
    meta.prepare(`DELETE FROM resource_grants WHERE node_id IN (${placeholders})`).run(...ids)
    // A group is also a principal, so its id can appear on grants and access rows
    // belonging to *other* nodes. Leaving those behind would strand a grant whose
    // roster no longer exists — and if the id were ever reissued, revive it.
    meta.prepare(`DELETE FROM resource_grants WHERE principal_type = 'node' AND principal_id IN (${placeholders})`).run(...ids)
    meta.prepare(`DELETE FROM connection_access WHERE principal_type = 'node' AND principal_id IN (${placeholders})`).run(...ids)
    meta.prepare(`DELETE FROM node_members WHERE node_id IN (${placeholders})`).run(...ids)
    meta.prepare(`DELETE FROM resource_nodes WHERE id IN (${placeholders})`).run(...ids)
  })()
  invalidateResolution()
  return { ok: true }
}

/**
 * Delete the node mirroring a resource, when that resource is deleted.
 *
 * The subtree goes with it, which is right for every caller: a workspace's
 * cascade deletes everything inside it, and a connection takes its dashboards and
 * workflows. Nothing else mirrored can hold children.
 */
export const deleteResourceNode = (type, resourceId) => {
  const node = nodeFor(type, resourceId)
  if (node) deleteNode(node.id)
}

/**
 * Re-file a resource's node under a different group. The everyday move: dragging
 * a connection into a group you made to scope access with.
 */
export const moveResourceNode = (type, resourceId, newParentId) => {
  const node = nodeFor(type, resourceId)
  return node ? moveNode(node.id, newParentId) : { error: 'Node not found.' }
}
