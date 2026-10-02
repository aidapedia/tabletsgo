/**
 * Workspace RBAC — the roles an instance admin defines and what they grant.
 *
 * Owns `roles` and `role_permissions`, and is the only module that answers "may
 * this user do X in this workspace". A membership's grant holds a role *slug*
 * from the `roles` table; it used to hold the literal 'owner' or 'member', and
 * those are now seeded rows with exactly those slugs, so no membership row had to
 * change when roles became configurable.
 *
 * Two boundaries worth keeping:
 *
 *   1. **Roles are instance-wide.** An instance admin defines the access model
 *      once and a workspace owner assigns people to it. One catalog to audit
 *      beats one per tenant, and it is what "admin sets up the roles" means.
 *   2. **The system tier stays hardcoded.** `users.role` ('admin' | 'user') is
 *      not in this model — see server/auth.js. Instance administration
 *      deliberately carries no workspace data access, so a configurable system
 *      role would only be a way to grant an admin the data they're meant not to
 *      have.
 *
 * The whole policy — a few dozen rows — lives in memory: `loadPolicy()` reads it
 * once at boot and again after every write here, so every lookup below stays a
 * synchronous read of that cache, on the hot path of every permission check.
 */

import { randomUUID } from 'crypto'
import { db, transaction } from './meta.js'
import {
  BUILTIN_ROLES,
  NODE_TYPES,
  NODE_TYPE_KEYS,
  OWNER_PERMISSION,
  PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSION_SCOPE,
} from './permissions-catalog.js'

// Re-exported so callers have a single import site for "everything about
// permissions" and never have to know the catalog is a separate leaf module.
export { BUILTIN_ROLES, NODE_TYPES, NODE_TYPE_KEYS, OWNER_PERMISSION, PERMISSIONS, PERMISSION_KEYS, PERMISSION_SCOPE }

// A stored `applies_to` is a JSON array of node types; anything else — NULL, junk
// left by an older image, an empty array — reads as "any type", which is what
// every role created before the column existed means.
const parseAppliesTo = (raw) => {
  if (!raw) return null
  try {
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return null
    const clean = list.filter((t) => NODE_TYPE_KEYS.has(t))
    return clean.length ? clean : null
  } catch {
    return null
  }
}

const serializeAppliesTo = (list) => {
  if (!Array.isArray(list)) return null
  const clean = [...new Set(list.filter((t) => NODE_TYPE_KEYS.has(t)))]
  return clean.length ? JSON.stringify(clean) : null
}

// ---- Policy cache ----
// A handful of rows read on nearly every request, so hold them in memory and
// reload the lot on write. Single process (see README), so this process's
// writes are the only ones there are.
let cache = null

/**
 * Bumped whenever the policy changes. `server/resource-tree.js` memoizes
 * resolution results and keys them on this, so a role edit drops its answers too
 * — without this module having to know the resolver exists (it depends on us, not
 * the other way round).
 */
let version = 0
export const policyVersion = () => version

/** Read the policy into memory. Called at boot, and by every write below. */
export async function loadPolicy() {
  const [roles, grants] = await Promise.all([db().roles.findMany(), db().role_permissions.findMany()])
  cache = new Map(
    roles.map((r) => [
      r.slug,
      {
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description || '',
        builtin: !!r.builtin,
        // null = grantable on any node type.
        appliesTo: parseAppliesTo(r.applies_to),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        // Unknown keys are dropped, not honoured: the catalog in code is the
        // authority on what a permission means.
        permissions: new Set(grants.filter((g) => g.role_id === r.id && PERMISSION_KEYS.has(g.permission)).map((g) => g.permission)),
      },
    ])
  )
  version += 1
  return cache
}

const policy = () => {
  if (!cache) throw new Error('The role policy is not loaded — await loadPolicy() at boot.')
  return cache
}

// ---- Reads ----
const toPublic = (role) => ({
  id: role.id,
  slug: role.slug,
  name: role.name,
  description: role.description,
  builtin: role.builtin,
  permissions: [...role.permissions],
  appliesTo: role.appliesTo,
  createdAt: role.createdAt,
  updatedAt: role.updatedAt,
})

// Built-ins first, then alphabetically — one stable order for the admin list and
// every role dropdown rendered from it.
export const listRoles = () =>
  [...policy().values()].map(toPublic).sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name))

export const getRole = (slug) => {
  const role = policy().get(slug)
  return role ? toPublic(role) : null
}

export const roleExists = (slug) => policy().has(slug)

/**
 * The permissions a membership role carries. 'admin' is the pre-v8 spelling of
 * 'owner' (normalized the same way server/auth.js `memberRole` does it); any
 * other unknown slug grants nothing, so a membership pointing at a role that no
 * longer exists fails closed.
 */
export const permissionsForRole = (slug) => {
  if (!slug) return new Set()
  const role = policy().get(slug === 'admin' ? 'owner' : slug)
  return role ? role.permissions : new Set()
}

// The one place route guards and the workspace helpers agree on what a role means.
export const roleHasPermission = (slug, permission) => permissionsForRole(slug).has(permission)

/**
 * A grant's **requirement criteria**: may this role be handed out on a node of
 * this type? Two independent tests, and both must pass.
 *
 *   1. `appliesTo` — the admin's own answer. Null means "anywhere".
 *   2. Every permission the role carries must be meaningful at that node type
 *      (`PERMISSION_SCOPE`), because a grant that can never be asked about is a
 *      promise the routes can't keep.
 *
 * Returns `{ ok, reason }` rather than a boolean so a route can say *which* rule
 * refused — "Owner can only be granted on a workspace" is actionable, "Forbidden"
 * is not.
 */
export const roleGrantableOn = (slug, type) => {
  const role = policy().get(slug === 'admin' ? 'owner' : slug)
  if (!role) return { ok: false, reason: 'That role no longer exists.' }
  if (!NODE_TYPE_KEYS.has(type)) return { ok: false, reason: 'Unknown node type.' }

  if (role.appliesTo && !role.appliesTo.includes(type)) {
    return { ok: false, reason: `${role.name} can only be granted on: ${role.appliesTo.join(', ')}.` }
  }

  // A permission scoped to 'workspace' needs a node that *is* a workspace or
  // contains one; the depth order below is the containment order of the tree.
  const depthOf = { application: 0, workspace: 1, group: 2, connection: 3, storage: 3, dashboard: 4, workflow: 4 }
  const here = depthOf[type] ?? 99
  for (const permission of role.permissions) {
    const scope = PERMISSION_SCOPE.get(permission)
    if (scope && here > (depthOf[scope] ?? 99)) {
      return { ok: false, reason: `${role.name} grants "${permission}", which only means something at ${scope} level or above.` }
    }
  }
  return { ok: true, reason: null }
}

// The roles that may be granted on a node of this type — what the grant editor
// offers, so the UI never presents a choice the server would refuse.
export const rolesGrantableOn = (type) => listRoles().filter((r) => roleGrantableOn(r.slug, type).ok)

/**
 * Role slugs that count as owning a workspace — those carrying OWNER_PERMISSION.
 * The last-owner invariant counts memberships holding one of these, so a renamed
 * or custom role that grants `workspace.manage` protects the workspace exactly
 * like the built-in `owner` does.
 */
export const ownerRoleSlugs = () => {
  const slugs = [...policy().values()].filter((r) => r.permissions.has(OWNER_PERMISSION)).map((r) => r.slug)
  // 'admin' is the pre-v8 spelling still present in old membership rows; it
  // reads as 'owner', so the SQL that counts owners has to match it too.
  return slugs.includes('owner') ? [...slugs, 'admin'] : slugs
}

// ---- Writes ----
const writeGrants = async (roleId, permissions) => {
  await db().role_permissions.deleteMany({ where: { role_id: roleId } })
  const keys = [...new Set(permissions)].filter((p) => PERMISSION_KEYS.has(p))
  if (keys.length) await db().role_permissions.createMany({ data: keys.map((permission) => ({ role_id: roleId, permission })) })
}

export const createRole = async ({ name, description = '', permissions = [], appliesTo = null }) => {
  const id = randomUUID()
  const now = Date.now()
  const slug = uniqueSlug(name)
  await transaction(async () => {
    await db().roles.create({
      data: { id, slug, name: name.trim(), description: description.trim(), builtin: 0, applies_to: serializeAppliesTo(appliesTo), created_at: now, updated_at: now },
    })
    await writeGrants(id, permissions)
  })
  await loadPolicy()
  return getRole(slug)
}

/**
 * Rename a role or change what it grants. The slug never moves — memberships
 * reference it — and `owner` always keeps OWNER_PERMISSION, because a workspace
 * whose owners can't manage it is a workspace nobody can fix.
 */
export const updateRole = async (slug, { name, description, permissions, appliesTo }) => {
  const role = policy().get(slug)
  if (!role) return null
  const next = Array.isArray(permissions) ? permissions.filter((p) => PERMISSION_KEYS.has(p)) : null
  // `appliesTo` is three-valued: undefined leaves it alone, null widens it back to
  // "any type", an array narrows it. Existing grants are not re-checked — narrowing
  // the criteria decides what may be granted next, it doesn't revoke what someone
  // already holds (which would take access away silently, from a role edit).
  const criteria = appliesTo === undefined ? undefined : serializeAppliesTo(appliesTo)
  await transaction(async () => {
    await db().roles.update({
      where: { id: role.id },
      data: {
        name: String(name ?? role.name).trim(),
        description: String(description ?? role.description).trim(),
        updated_at: Date.now(),
        ...(criteria !== undefined ? { applies_to: criteria } : null),
      },
    })
    if (next) await writeGrants(role.id, slug === 'owner' ? [...new Set([...next, OWNER_PERMISSION])] : next)
  })
  await loadPolicy()
  return getRole(slug)
}

export const deleteRole = async (slug) => {
  const role = policy().get(slug)
  if (!role) return
  await transaction(async () => {
    await db().role_permissions.deleteMany({ where: { role_id: role.id } })
    await db().roles.delete({ where: { id: role.id } })
  })
  await loadPolicy()
}

/**
 * Everything across the instance currently holding this role. A role in use can't
 * be deleted: those holders would silently fail closed to no access.
 *
 * Grants are the whole answer since meta migration v16 — a membership no longer
 * carries a role of its own, it *is* a grant on the workspace's node.
 */
export const countRoleUsage = async (slug) => db().resource_grants.count({ where: { role_slug: slug } })

/**
 * How many grants hold each role, as `{ [slug]: { members, grants } }`.
 *
 * `members` is kept in the shape for the client that reads it, and is now always
 * the count of grants made on a *workspace* node — which is exactly what a
 * membership role is.
 *
 * Two grouped queries rather than `countRoleUsage` per role — and deliberately
 * not folded into the cached policy: usage changes on every invite, role move and
 * grant, while the policy only changes when an admin edits it, so caching the two
 * together would mean invalidating the policy far more often than it changes.
 * Pre-v8 rows spelled `owner` as `admin`; fold them in so the count matches what
 * the delete guard will actually find.
 */
export const roleUsageCounts = async () => {
  const counts = {}
  const bump = (slug, key, n) => {
    const s = slug === 'admin' ? 'owner' : slug
    counts[s] = counts[s] || { members: 0, grants: 0 }
    counts[s][key] += n
  }
  const members = await db().$queryRaw`
    SELECT g.role_slug AS role, COUNT(*) AS c FROM resource_grants g
      JOIN resource_nodes n ON n.id = g.node_id
     WHERE n.type = 'workspace' AND g.principal_type = 'user' GROUP BY g.role_slug`
  for (const { role, c } of members) bump(role, 'members', c)
  const grants = await db().resource_grants.groupBy({ by: ['role_slug'], _count: { _all: true } })
  for (const { role_slug: role, _count } of grants) bump(role, 'grants', _count._all)
  return counts
}

/**
 * A URL-safe slug derived from the name, suffixed if taken. This is what
 * a grant stores, so it is fixed at creation — renaming a role
 * later leaves every membership untouched.
 */
function uniqueSlug(name) {
  const base =
    String(name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'role'
  const taken = policy()
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}
