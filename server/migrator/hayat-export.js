/**
 * Everything tabletsgo's own identity and access tables held, as the bundle
 * Hayat's `hayat import` loads — written by the migrator right before the
 * migration that drops those tables (20261110000000_hayat_owns_identity), and by
 * `npm run hayat:bundle` by hand.
 *
 * The bundle is already in Hayat's terms, so Hayat only writes it:
 *
 *   users            kept ids; the unsalted SHA-256 hash becomes `$sha256$<hex>`,
 *                    which Hayat verifies once and replaces with argon2id
 *   workspaces       tenants with the same ids; the roster is the workspace node's
 *   groups           group nodes, parents before children, with their rosters
 *   connections,     resources of `tabletsgo/connection` / `tabletsgo/storage`,
 *   storage          filed where their node was, owned by the same person
 *   grants           built-in `owner` → Hayat's Tenant admin + tabletsgo's owner;
 *                    `member` → nothing (it granted nothing); a custom role → a
 *                    role created with the same permissions
 *   access lists     each `connection_access` row → the `connection-user` role on
 *                    that connection, to the same person or group
 *   instance admins  the `tabletsgo.admin` role at Hayat's root
 *
 * Dashboard and workflow nodes are not carried over — Hayat mirrors only
 * connections and storage — so a grant made on one is reported and skipped.
 *
 * Columns are read with `SELECT *`: it runs before any migration still pending,
 * so a column a later one adds (users.timezone) may not exist yet.
 *
 * Synchronous over a migrator handle (server/meta-connection.js): it must run
 * before the drop, inside the migrator, which never opens server/meta.js.
 */

import { randomUUID } from 'crypto'
import { CONNECTION_TYPE, STORAGE_TYPE, SERVICE, contractManifest, hayatKey, roleSlug } from '../permissions-catalog.js'

const NODE_TYPE_TO_HAYAT = {
  application: 'hayat/root',
  workspace: 'hayat/tenant',
  group: 'hayat/group',
  connection: CONNECTION_TYPE,
  storage: STORAGE_TYPE,
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const parseJson = (raw, fallback) => {
  try {
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

/** The bundle envelope with tabletsgo's contract and nothing else — a fresh install. */
export function emptyBundle() {
  return {
    format: 'hayat-import',
    version: 1,
    source: SERVICE,
    service: {
      id: SERVICE,
      displayName: 'Tabletsgo',
      description: 'Database console: connections, storage destinations and who may use them.',
      contract: contractManifest(),
    },
    users: [],
    roles: [],
    rootGrants: [],
    tenants: [],
    skipped: [],
  }
}

/**
 * Make the person at `email` an admin in the bundle: tabletsgo's Admin role at
 * Hayat's root, and Hayat's first instance admin when Hayat has none yet. Someone
 * the bundle doesn't hold is added as a pending account with no password — they
 * finish by signing up at Hayat with that address, which mails them the link to
 * choose one. This is how a fresh install gets its first admin.
 */
export function addBundleAdmin(bundle, email) {
  const address = String(email || '').trim().toLowerCase()
  if (!address) return bundle
  let u = bundle.users.find((x) => x.email.toLowerCase() === address)
  if (!u) {
    u = { id: randomUUID(), email: address, name: '', passwordHash: '', status: 'pending', zoneinfo: '', admin: false }
    bundle.users.push(u)
  }
  if (!u.admin) {
    u.admin = true
    bundle.rootGrants.push({ userId: u.id, role: roleSlug('admin') })
  }
  return bundle
}

/**
 * Read the old tables through `db` (a migrator handle) into a bundle.
 * `hasTable(name)` says which exist — an older install may lack the newer ones.
 */
export function exportHayatBundle(db, hasTable) {
  const bundle = emptyBundle()
  if (!hasTable('users')) return bundle
  const all = (sql, ...args) => db.prepare(sql).all(...args)
  const rows = (table, sql) => (hasTable(table) ? all(sql) : [])
  const skip = (what) => bundle.skipped.push(what)

  // ---- People ----
  // Hayat signs people in by email. An account whose sign-in name isn't one (the
  // old seeded `admin`) can't be carried over, and Hayat would refuse the whole
  // bundle for it — so it is left out, with everything that names it.
  const userIds = new Set()
  for (const u of all('SELECT * FROM users')) {
    if (!EMAIL.test(String(u.username || '').trim())) {
      skip(`account "${u.username}": its sign-in name isn't an email address, and Hayat signs people in by email — sign up at Hayat with an address instead`)
      continue
    }
    userIds.add(u.id)
    bundle.users.push({
      id: u.id,
      email: u.username,
      name: u.name || '',
      passwordHash: u.password_hash ? `$sha256$${u.password_hash}` : '',
      status: u.status === 'pending' ? 'pending' : 'active',
      zoneinfo: u.timezone || '',
      admin: u.role === 'admin',
    })
    if (u.role === 'admin') bundle.rootGrants.push({ userId: u.id, role: roleSlug('admin') })
  }

  // ---- Roles: a slug in the old store → what to grant in Hayat ----
  const perms = new Map()
  for (const r of rows('role_permissions', 'SELECT role_id, permission FROM role_permissions')) {
    if (!perms.has(r.role_id)) perms.set(r.role_id, [])
    perms.get(r.role_id).push(r.permission)
  }
  const grantRoles = new Map([
    ['owner', ['hayat.tenant-admin', roleSlug('owner')]],
    ['admin', ['hayat.tenant-admin', roleSlug('owner')]], // the pre-v8 spelling of owner
    ['member', []],
  ])
  for (const r of rows('roles', 'SELECT * FROM roles')) {
    if (grantRoles.has(r.slug)) continue
    const keys = new Set()
    for (const p of perms.get(r.id) || []) {
      try {
        keys.add(hayatKey(p))
      } catch {
        // A key no route asks for any more is dropped, as the old resolver did.
      }
    }
    // Managing a connection always included opening it; in Hayat that is its own key.
    if (keys.has(hayatKey('connections.manage'))) keys.add(hayatKey('connection.open'))
    if (!keys.size) {
      grantRoles.set(r.slug, [])
      continue
    }
    const appliesTo = parseJson(r.applies_to, null)
    const types = Array.isArray(appliesTo) ? [...new Set(appliesTo.map((t) => NODE_TYPE_TO_HAYAT[t]).filter(Boolean))] : []
    const key = `custom:${r.slug}`
    bundle.roles.push({ key, name: r.name, description: r.description || '', permissions: [...keys], appliesTo: types })
    grantRoles.set(r.slug, [key])
  }

  // ---- The tree ----
  const nodes = rows('resource_nodes', 'SELECT id, parent_id, type, resource_id, name, owner_id, workspace_id, depth FROM resource_nodes ORDER BY depth')
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const nodeFor = (type, resourceId) => nodes.find((n) => n.type === type && n.resource_id === resourceId) || null
  const roster = new Map()
  for (const m of rows('node_members', 'SELECT node_id, user_id FROM node_members')) {
    if (!userIds.has(m.user_id)) continue
    if (!roster.has(m.node_id)) roster.set(m.node_id, [])
    roster.get(m.node_id).push(m.user_id)
  }
  const grants = rows('resource_grants', 'SELECT node_id, principal_type, principal_id, role_slug, inherit FROM resource_grants')

  // A node's parent, as the bundle names it: '' for the workspace, else the group.
  const parentKey = (node) => {
    const parent = node && nodeById.get(node.parent_id)
    return parent && parent.type === 'group' ? parent.id : ''
  }

  // Where a grant sits, and who it names, in bundle terms (null: not carried over).
  const onOf = (node) => {
    if (!node) return null
    if (node.type === 'workspace') return 'tenant'
    if (node.type === 'group') return `group:${node.id}`
    if (node.type === 'connection' || node.type === 'storage') return `resource:${NODE_TYPE_TO_HAYAT[node.type]}:${node.resource_id}`
    return null
  }
  const principalOf = (type, id, wsNode) => {
    if (type === 'user') return userIds.has(id) ? `user:${id}` : null
    if (id === wsNode.id) return 'tenant'
    const n = nodeById.get(id)
    return n && n.type === 'group' && n.workspace_id === wsNode.resource_id ? `group:${n.id}` : null
  }

  // Grants at the application root: instance-wide, people only.
  const root = nodes.find((n) => n.type === 'application')
  for (const g of grants.filter((g) => root && g.node_id === root.id)) {
    if (g.principal_type !== 'user' || !userIds.has(g.principal_id)) continue
    for (const role of grantRoles.get(g.role_slug) || []) {
      if (role === 'hayat.tenant-admin') continue // a tenant role means nothing at the root
      bundle.rootGrants.push({ userId: g.principal_id, role })
    }
  }

  const access = rows('connection_access', 'SELECT connection_id, principal_type, principal_id FROM connection_access')

  for (const ws of all('SELECT id, name FROM workspaces ORDER BY created_at')) {
    const wsNode = nodeFor('workspace', ws.id)
    const members = wsNode ? roster.get(wsNode.id) || [] : []
    if (!wsNode || !members.length) {
      skip(`workspace "${ws.name}": nobody belongs to it, and a Hayat tenant needs an owner`)
      continue
    }
    const wsGrants = grants.filter((g) => {
      const n = nodeById.get(g.node_id)
      return n && n.workspace_id === ws.id
    })
    const owners = wsGrants
      .filter((g) => g.node_id === wsNode.id && g.principal_type === 'user' && ['owner', 'admin'].includes(g.role_slug) && members.includes(g.principal_id))
      .map((g) => g.principal_id)
    const ownerId = (wsNode.owner_id && members.includes(wsNode.owner_id) && wsNode.owner_id) || owners[0] || members[0]

    const tenant = { id: ws.id, name: ws.name, ownerId, members, groups: [], resources: [], grants: [] }
    for (const g of nodes.filter((n) => n.type === 'group' && n.workspace_id === ws.id)) {
      tenant.groups.push({ key: g.id, parent: parentKey(g), name: g.name, members: roster.get(g.id) || [] })
    }
    for (const c of all('SELECT id, name, owner_id FROM connections WHERE workspace_id = ?', ws.id)) {
      tenant.resources.push({ type: CONNECTION_TYPE, externalId: c.id, name: c.name || c.id, parent: parentKey(nodeFor('connection', c.id)), ownerId: userIds.has(c.owner_id) ? c.owner_id : '' })
    }
    for (const s of all('SELECT id, name FROM storage_destinations WHERE workspace_id = ?', ws.id)) {
      const node = nodeFor('storage', s.id)
      tenant.resources.push({ type: STORAGE_TYPE, externalId: s.id, name: s.name || s.id, parent: parentKey(node), ownerId: userIds.has(node?.owner_id) ? node.owner_id : '' })
    }
    const resourceIds = new Set(tenant.resources.map((r) => r.externalId))

    for (const g of wsGrants) {
      const node = nodeById.get(g.node_id)
      const on = onOf(node)
      const principal = principalOf(g.principal_type, g.principal_id, wsNode)
      if (!on || !principal || (node.type !== 'workspace' && node.type !== 'group' && !resourceIds.has(node.resource_id))) {
        if ((grantRoles.get(g.role_slug) || []).length) skip(`grant of "${g.role_slug}" on ${node?.type} "${node?.name}" (not mirrored in Hayat)`)
        continue
      }
      for (const role of grantRoles.get(g.role_slug) || []) {
        // Hayat's Tenant admin applies to the tenant only; a group grant keeps tabletsgo's half.
        if (role === 'hayat.tenant-admin' && on !== 'tenant') continue
        tenant.grants.push({ on, principal, role, inherit: !!g.inherit })
      }
    }
    for (const a of access.filter((a) => resourceIds.has(a.connection_id))) {
      const principal = principalOf(a.principal_type === 'node' ? 'node' : 'user', a.principal_id, wsNode)
      if (!principal) continue
      tenant.grants.push({ on: `resource:${CONNECTION_TYPE}:${a.connection_id}`, principal, role: roleSlug('connection-user'), inherit: true })
    }
    bundle.tenants.push(tenant)
  }
  return bundle
}

/**
 * A solo instance as the bundle `hayat import` loads: its owner, its one
 * workspace as a tenant with the same id, and its connections and storage
 * destinations as resources the owner owns. Written when the instance moves to
 * enterprise (server/migrator/identity.js) and by `npm run hayat:bundle`.
 *
 * The owner's scrypt hash means nothing to Hayat, so they arrive as a pending
 * account and finish by signing up at Hayat with the same email — keeping their
 * id, and with it everything they own. A v1.0 hash nobody has signed in with
 * since (`$sha256$…`) is one Hayat does read, so that account arrives active.
 */
export function exportSoloBundle(db, hasTable) {
  const bundle = emptyBundle()
  const row = hasTable('app_settings') ? db.prepare("SELECT value FROM app_settings WHERE key = 'solo'").get() : null
  const solo = parseJson(row?.value, null)
  if (!solo?.owner) return bundle
  const o = solo.owner
  const legacy = String(o.passwordHash || '').startsWith('$sha256$')
  bundle.users.push({
    id: o.id,
    email: o.email,
    name: o.name || '',
    passwordHash: legacy ? o.passwordHash : '',
    status: legacy ? 'active' : 'pending',
    zoneinfo: o.timezone || '',
    admin: true,
  })
  bundle.rootGrants.push({ userId: o.id, role: roleSlug('admin') })

  const ws = solo.workspace
  const tenant = { id: ws.id, name: ws.name || 'Personal', ownerId: o.id, members: [o.id], groups: [], resources: [], grants: [] }
  const all = (sql) => db.prepare(sql).all(ws.id)
  if (hasTable('connections')) {
    for (const c of all('SELECT id, name FROM connections WHERE workspace_id = ?')) {
      tenant.resources.push({ type: CONNECTION_TYPE, externalId: c.id, name: c.name || c.id, parent: '', ownerId: o.id })
    }
  }
  if (hasTable('storage_destinations')) {
    for (const s of all('SELECT id, name FROM storage_destinations WHERE workspace_id = ?')) {
      tenant.resources.push({ type: STORAGE_TYPE, externalId: s.id, name: s.name || s.id, parent: '', ownerId: o.id })
    }
  }
  for (const role of ['hayat.tenant-admin', roleSlug('owner')]) tenant.grants.push({ on: 'tenant', principal: `user:${o.id}`, role, inherit: true })
  bundle.tenants.push(tenant)
  return bundle
}
