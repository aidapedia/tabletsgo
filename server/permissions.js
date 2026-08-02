/**
 * Workspace RBAC — the roles an instance admin defines and what they grant.
 *
 * Owns `roles` and `role_permissions`, and is the only module that answers "may
 * this user do X in this workspace". `workspace_members.role` holds a role *slug*
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
 * Lookups are synchronous because every route guard is (making `requireAuth`
 * async is the one thing server/auth.js forbids), so the whole policy — a few
 * dozen rows — lives in memory and is dropped on write.
 */

import { randomUUID } from 'crypto'
import { meta } from './meta.js'
import { BUILTIN_ROLES, OWNER_PERMISSION, PERMISSIONS, PERMISSION_KEYS } from './permissions-catalog.js'

// Re-exported so callers have a single import site for "everything about
// permissions" and never have to know the catalog is a separate leaf module.
export { BUILTIN_ROLES, OWNER_PERMISSION, PERMISSIONS, PERMISSION_KEYS }

// ---- Policy cache ----
// A handful of rows read on nearly every request, so hold them in memory and
// drop the lot on write. Sync by necessity: the guards are.
let cache = null

const loadPolicy = () => {
  if (cache) return cache
  const roles = meta.prepare('SELECT id, slug, name, description, builtin, created_at, updated_at FROM roles').all()
  const grants = meta.prepare('SELECT role_id, permission FROM role_permissions').all()
  cache = new Map(
    roles.map((r) => [
      r.slug,
      {
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description || '',
        builtin: !!r.builtin,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        // Unknown keys are dropped, not honoured: the catalog in code is the
        // authority on what a permission means.
        permissions: new Set(grants.filter((g) => g.role_id === r.id && PERMISSION_KEYS.has(g.permission)).map((g) => g.permission)),
      },
    ])
  )
  return cache
}

export const invalidatePolicy = () => {
  cache = null
}

// ---- Reads ----
const toPublic = (role) => ({
  id: role.id,
  slug: role.slug,
  name: role.name,
  description: role.description,
  builtin: role.builtin,
  permissions: [...role.permissions],
  createdAt: role.createdAt,
  updatedAt: role.updatedAt,
})

// Built-ins first, then alphabetically — one stable order for the admin list and
// every role dropdown rendered from it.
export const listRoles = () =>
  [...loadPolicy().values()].map(toPublic).sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name))

export const getRole = (slug) => {
  const role = loadPolicy().get(slug)
  return role ? toPublic(role) : null
}

export const roleExists = (slug) => loadPolicy().has(slug)

/**
 * The permissions a membership role carries. 'admin' is the pre-v8 spelling of
 * 'owner' (normalized the same way server/auth.js `memberRole` does it); any
 * other unknown slug grants nothing, so a membership pointing at a role that no
 * longer exists fails closed.
 */
export const permissionsForRole = (slug) => {
  if (!slug) return new Set()
  const role = loadPolicy().get(slug === 'admin' ? 'owner' : slug)
  return role ? role.permissions : new Set()
}

// The one place route guards and the workspace helpers agree on what a role means.
export const roleHasPermission = (slug, permission) => permissionsForRole(slug).has(permission)

/**
 * Role slugs that count as owning a workspace — those carrying OWNER_PERMISSION.
 * The last-owner invariant counts memberships holding one of these, so a renamed
 * or custom role that grants `workspace.manage` protects the workspace exactly
 * like the built-in `owner` does.
 */
export const ownerRoleSlugs = () => {
  const slugs = [...loadPolicy().values()].filter((r) => r.permissions.has(OWNER_PERMISSION)).map((r) => r.slug)
  // 'admin' is the pre-v8 spelling still present in old membership rows; it
  // reads as 'owner', so the SQL that counts owners has to match it too.
  return slugs.includes('owner') ? [...slugs, 'admin'] : slugs
}

// ---- Writes ----
const writeGrants = (roleId, permissions) => {
  meta.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId)
  const ins = meta.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)')
  for (const p of permissions) if (PERMISSION_KEYS.has(p)) ins.run(roleId, p)
}

export const createRole = ({ name, description = '', permissions = [] }) => {
  const id = randomUUID()
  const now = Date.now()
  const slug = uniqueSlug(name)
  meta.transaction(() => {
    meta
      .prepare('INSERT INTO roles (id, slug, name, description, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
      .run(id, slug, name.trim(), description.trim(), now, now)
    writeGrants(id, permissions)
  })()
  invalidatePolicy()
  return getRole(slug)
}

/**
 * Rename a role or change what it grants. The slug never moves — memberships
 * reference it — and `owner` always keeps OWNER_PERMISSION, because a workspace
 * whose owners can't manage it is a workspace nobody can fix.
 */
export const updateRole = (slug, { name, description, permissions }) => {
  const role = loadPolicy().get(slug)
  if (!role) return null
  const next = Array.isArray(permissions) ? permissions.filter((p) => PERMISSION_KEYS.has(p)) : null
  meta.transaction(() => {
    meta
      .prepare('UPDATE roles SET name = ?, description = ?, updated_at = ? WHERE id = ?')
      .run(String(name ?? role.name).trim(), String(description ?? role.description).trim(), Date.now(), role.id)
    if (next) writeGrants(role.id, slug === 'owner' ? [...new Set([...next, OWNER_PERMISSION])] : next)
  })()
  invalidatePolicy()
  return getRole(slug)
}

export const deleteRole = (slug) => {
  const role = loadPolicy().get(slug)
  if (!role) return
  meta.transaction(() => {
    meta.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(role.id)
    meta.prepare('DELETE FROM roles WHERE id = ?').run(role.id)
  })()
  invalidatePolicy()
}

// Memberships across the instance currently holding this role. A role in use
// can't be deleted: those memberships would silently fail closed to no access.
export const countRoleUsage = (slug) => meta.prepare('SELECT COUNT(*) c FROM workspace_members WHERE role = ?').get(slug).c

/**
 * A URL-safe slug derived from the name, suffixed if taken. This is what
 * `workspace_members.role` stores, so it is fixed at creation — renaming a role
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
  const taken = loadPolicy()
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}
