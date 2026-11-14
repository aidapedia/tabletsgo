/**
 * Hayat, in tabletsgo's terms — the one place that asks who someone is, which
 * workspaces they belong to and what they may do.
 *
 * Hayat owns all of it (CLAUDE.md "INVARIANTS"): accounts and sign-in, each
 * workspace (a Hayat *tenant*) and its roster, groups, roles and grants. This
 * module only asks, and mirrors the two resources tabletsgo owns — connections
 * and storage destinations — into Hayat's tree so grants can be made on them.
 *
 * Answers are cached for a few seconds and dropped the moment Hayat's Watch
 * stream reports a change to the tenant they came from (every change for a
 * global one), so a grant made in Hayat's console reaches tabletsgo well before
 * the TTL would. After a write of our own, the next reads ask for at least that
 * revision (read-your-writes), like Hayat's SDKs.
 *
 * Sits just above config.js in the dependency order: it imports no meta store,
 * so anything may use it.
 */

import {
  HAYAT_API_URL,
  HAYAT_AUTH_URL,
  HAYAT_CLIENT_ID,
  HAYAT_CLIENT_SECRET,
  HAYAT_CONFIGURED,
  HAYAT_CONSOLE_URL,
  HAYAT_ISSUER,
  HAYAT_WEB_CLIENT_ID,
} from '../config.js'
import { connectHayat, HayatError } from './connect.js'

export { HayatError }

// Hayat's root node: instance-wide grants (the tabletsgo admin role) sit here.
export const ROOT_NODE_ID = '00000000-0000-0000-0000-000000000001'
const GLOBAL = '00000000-0000-0000-0000-000000000000'
const TTL_MS = 10_000
const DIRECTORY_TTL_MS = 60_000

export const ref = (type, externalId) => ({ type, externalId: String(externalId) })
export const nodeRef = (nodeId) => ({ nodeId: String(nodeId) })

// The transport. Tests swap in a fake with `useHayatBackend` — the same three
// functions: call(service, method, body), watch(cursor, onEvent, signal), verify(token).
let backend = HAYAT_CONFIGURED
  ? connectHayat({ issuer: HAYAT_ISSUER, authUrl: HAYAT_AUTH_URL, apiUrl: HAYAT_API_URL, clientId: HAYAT_CLIENT_ID, clientSecret: HAYAT_CLIENT_SECRET })
  : null

export function useHayatBackend(fake) {
  backend = fake
  clearCaches()
}

const need = () => {
  if (!backend) throw new HayatError('unavailable', 'Hayat is not configured — set HAYAT_ISSUER, HAYAT_API_URL, HAYAT_CLIENT_ID, HAYAT_CLIENT_SECRET and HAYAT_WEB_CLIENT_ID.')
  return backend
}

// ---- Caches -----------------------------------------------------------------

// key → { value, tenant, expires }. `tenant` is what a Watch event drops it by.
const decisions = new Map()
const users = new Map() // id → { value, expires }
const userTenantsCache = new Map() // userId → { value, expires }
const rosters = new Map() // tenantId → { value, expires }
const tenantGrantsCache = new Map() // tenantId → { value, expires }
let lastWrite = { rev: '0', at: 0 }

function clearCaches() {
  decisions.clear()
  users.clear()
  userTenantsCache.clear()
  rosters.clear()
  tenantGrantsCache.clear()
}

function dropTenant(tenantId) {
  if (!tenantId || tenantId === GLOBAL) return clearCaches()
  for (const [k, v] of decisions) if (v.tenant === tenantId) decisions.delete(k)
  rosters.delete(tenantId)
  tenantGrantsCache.delete(tenantId)
  // Which tenants someone belongs to may be what changed; the list is cheap to refetch.
  userTenantsCache.clear()
}

const fresh = (entry) => entry && entry.expires > Date.now()

function consistency() {
  return Date.now() - lastWrite.at < 2000 ? { atLeastRev: lastWrite.rev } : undefined
}

function wrote(tenantId, rev) {
  lastWrite = { rev: String(rev || '0'), at: Date.now() }
  dropTenant(tenantId)
}

const isNotFound = (e) => e instanceof HayatError && e.code === 'not_found'

// ---- Sign-in -------------------------------------------------------------------

/**
 * A person's Hayat access token → their user id. Verified offline (signature,
 * issuer, expiry) and checked to have been issued to tabletsgo's sign-in client,
 * so a token minted for another application can't be replayed here.
 */
export async function verifyAccessToken(token) {
  const claims = await need().verify(token)
  const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : []
  if (HAYAT_WEB_CLIENT_ID && claims.client_id !== HAYAT_WEB_CLIENT_ID && !aud.includes(HAYAT_WEB_CLIENT_ID)) {
    throw new Error('token was issued to another application')
  }
  return { userId: claims.sub, sessionId: claims.sid || null }
}

// ---- People --------------------------------------------------------------------

// A Hayat user in the shape tabletsgo's routes have always used: `username` is
// the email, `timezone` is the account's zone.
const toUser = (u) => ({
  id: u.id,
  email: u.email,
  username: u.email,
  name: u.name || '',
  timezone: u.zoneinfo || null,
  status: u.status || 'active',
  picture: u.picture || null,
})

/** Profiles for these ids → Map(id → user). Unknown ids are left out. */
export async function getUsers(ids) {
  const want = [...new Set(ids.filter(Boolean).map(String))]
  const out = new Map()
  const missing = []
  for (const id of want) {
    const hit = users.get(id)
    if (fresh(hit)) out.set(id, hit.value)
    else missing.push(id)
  }
  for (let i = 0; i < missing.length; i += 500) {
    const res = await need().call('DirectoryService', 'BatchGetUsers', { ids: missing.slice(i, i + 500) })
    for (const raw of res.users || []) {
      const u = toUser(raw)
      users.set(u.id, { value: u, expires: Date.now() + DIRECTORY_TTL_MS })
      out.set(u.id, u)
    }
  }
  return out
}

export const getUser = async (id) => (id ? (await getUsers([id])).get(String(id)) || null : null)

/** Workspaces (Hayat tenants) this person belongs to: [{ id, name, slug, ownerId, nodeId, memberCount }]. */
export async function userTenants(userId) {
  const hit = userTenantsCache.get(userId)
  if (fresh(hit)) return hit.value
  const res = await need().call('DirectoryService', 'ListUserTenants', { userId })
  const value = (res.tenants || []).map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    ownerId: t.ownerUserId || null,
    nodeId: t.nodeId || null,
    memberCount: t.memberCount || 0,
  }))
  userTenantsCache.set(userId, { value, expires: Date.now() + TTL_MS })
  return value
}

/** A workspace's roster: [{ user, isOwner, joinedAt }]. Empty for an unknown tenant. */
export async function tenantMembers(tenantId) {
  const hit = rosters.get(tenantId)
  if (fresh(hit)) return hit.value
  let res
  try {
    res = await need().call('DirectoryService', 'ListTenantMembers', { tenantId })
  } catch (e) {
    if (isNotFound(e)) return []
    throw e
  }
  const value = (res.members || []).map((m) => ({ user: toUser(m.user), isOwner: !!m.isOwner, joinedAt: m.joinedAt ? Date.parse(m.joinedAt) : null }))
  for (const m of value) users.set(m.user.id, { value: m.user, expires: Date.now() + DIRECTORY_TTL_MS })
  rosters.set(tenantId, { value, expires: Date.now() + TTL_MS })
  return value
}

/**
 * What a workspace's members were given — the grants that reach each of them
 * (their own, a group's they are on, the whole workspace's) and the nodes they
 * own: [{ userId, resource: { nodeId, type, externalId, name }, via, role,
 * roleName, inherit, groupId, groupName }]. `via` is owner | user | group |
 * everyone. Hayat lists only its own node types and tabletsgo's. What it adds up
 * to is still `permissionsAt`'s answer. Empty for an unknown tenant.
 */
export async function tenantGrants(tenantId) {
  const hit = tenantGrantsCache.get(tenantId)
  if (fresh(hit)) return hit.value
  let res
  try {
    res = await need().call('DirectoryService', 'ListTenantGrants', { tenantId })
  } catch (e) {
    if (isNotFound(e)) return []
    throw e
  }
  const value = (res.grants || []).map((g) => ({
    userId: g.userId,
    resource: {
      nodeId: g.resource?.nodeId || null,
      type: g.resource?.type || '',
      externalId: g.resource?.externalId || '',
      name: g.resource?.name || '',
    },
    via: g.via,
    role: g.role || null,
    roleName: g.roleName || null,
    inherit: !!g.inherit,
    groupId: g.groupId || null,
    groupName: g.groupName || null,
  }))
  tenantGrantsCache.set(tenantId, { value, expires: Date.now() + TTL_MS })
  return value
}

// ---- Decisions -----------------------------------------------------------------

const refKey = (r) => `${r.type || ''}\0${r.externalId || ''}\0${r.nodeId || ''}`

/**
 * Every qualified permission this person holds at a node (an unknown node holds
 * nothing). One cached answer serves every check at that node — a page asks for
 * several in a row.
 */
export async function permissionsAt(userId, resource) {
  if (!userId) return new Set()
  const key = `${userId}\0${refKey(resource)}`
  const hit = decisions.get(key)
  if (fresh(hit)) return hit.value
  let res
  try {
    res = await need().call('AuthzService', 'PermissionsAt', { userId, resource, consistency: consistency() })
  } catch (e) {
    if (isNotFound(e)) return new Set()
    throw e
  }
  const value = new Set(res.permissions || [])
  decisions.set(key, { value, tenant: res.tenantId || GLOBAL, expires: Date.now() + TTL_MS })
  return value
}

export const check = async (userId, permission, resource) => (await permissionsAt(userId, resource)).has(permission)

/** People who really hold `permission` at a node, each with Hayat's reason. */
export async function lookupSubjects(permission, resource) {
  try {
    const res = await need().call('AuthzService', 'LookupSubjects', { permission, resource, consistency: consistency() })
    return (res.subjects || []).map((s) => ({ userId: s.userId, reason: s.reason?.text || null }))
  } catch (e) {
    if (isNotFound(e)) return []
    throw e
  }
}

// ---- The resources tabletsgo mirrors ----------------------------------------------

const toResource = (r) =>
  r ? { nodeId: r.nodeId, type: r.type, externalId: r.externalId, name: r.name, tenantId: r.tenantId, parentNodeId: r.parentNodeId || null, ownerId: r.ownerUserId || null } : null

export async function getResource(resource) {
  try {
    return toResource((await need().call('TreeService', 'GetResource', { resource })).resource)
  } catch (e) {
    if (isNotFound(e)) return null
    throw e
  }
}

/**
 * Create or update the node mirroring one of our resources. `parent` is a ref:
 * the workspace (`ref('hayat/tenant', id)`) or a group (`nodeRef(id)`).
 */
export async function upsertResource({ type, externalId, name, parent, ownerId }) {
  const res = await need().call('TreeService', 'UpsertResource', {
    type,
    externalId: String(externalId),
    name: name || String(externalId),
    parent,
    ownerUserId: ownerId || '',
  })
  wrote(res.tenantId, res.rev)
  return toResource(res.resource)
}

/**
 * Rename or re-own a mirror where it already sits. Hayat's upsert takes a parent,
 * so read the current one first; a missing mirror is filed under the workspace.
 */
export async function updateResource({ type, externalId, name, ownerId, workspaceId }) {
  const cur = await getResource(ref(type, externalId))
  const parent = cur?.parentNodeId ? nodeRef(cur.parentNodeId) : ref('hayat/tenant', workspaceId)
  return upsertResource({ type, externalId, name, parent, ownerId: ownerId ?? cur?.ownerId ?? '' })
}

/** Remove a mirror. Already gone is fine. */
export async function deleteResource(type, externalId) {
  try {
    const res = await need().call('TreeService', 'DeleteResource', { type, externalId: String(externalId) })
    wrote(res.tenantId, res.rev)
  } catch (e) {
    if (!isNotFound(e)) throw e
  }
}

// ---- Boot --------------------------------------------------------------------------

let watching = null

/**
 * Publish the contract when this version is new to Hayat (it then waits for an
 * owner's approval in Hayat's console), and start following policy changes.
 * Never throws: Hayat being briefly unreachable must not stop the app, and every
 * request will say so on its own.
 */
export async function startHayat({ contract, log = console.log } = {}) {
  if (!backend) return
  try {
    const res = await backend.call('SchemaService', 'PublishContract', { manifest: contract })
    log(`📜 Published tabletsgo's contract v${res.version} to Hayat — approve it in Hayat's console (Services → tabletsgo).`)
  } catch (e) {
    // Already published (or a newer one is): nothing to do. Anything else is worth a line.
    if (!/version must be greater|already waiting/.test(e.message)) log(`⚠️  Hayat: couldn't publish the contract: ${e.message}`)
  }
  if (backend.watch && !watching) {
    const ctrl = new AbortController()
    watching = ctrl
    void followChanges(ctrl.signal, log)
  }
}

export function stopHayat() {
  watching?.abort()
  watching = null
}

async function followChanges(signal, log) {
  let cursor = ''
  let backoff = 1000
  while (!signal.aborted) {
    try {
      await backend.watch(cursor, (event) => {
        cursor = event.id
        dropTenant(event.tenantId)
        backoff = 1000
      }, signal)
    } catch (e) {
      if (signal.aborted) return
      if (backoff >= 30_000) log(`⚠️  Hayat Watch: ${e.message}`)
    }
    // Whatever changed while disconnected is unknown.
    clearCaches()
    await new Promise((r) => setTimeout(r, backoff))
    backoff = Math.min(backoff * 2, 30_000)
  }
}

/** A link into Hayat's console, or null when its address isn't configured. */
export const consoleLink = (path = '') => (HAYAT_CONSOLE_URL ? `${HAYAT_CONSOLE_URL}${path}` : null)

/** What the browser needs to sign in: public, served before anyone is signed in. */
export const signInConfig = () => ({
  issuer: HAYAT_ISSUER || null,
  clientId: HAYAT_WEB_CLIENT_ID || null,
  consoleUrl: HAYAT_CONSOLE_URL || null,
})
