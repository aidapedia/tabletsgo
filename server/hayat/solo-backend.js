/**
 * Solo mode's backend: Hayat's answers for an instance of one person, worked
 * out in-process.
 *
 * server/hayat/index.js asks every question through a backend of three
 * functions — call(service, method, body), watch, verify — which is Hayat's
 * service API in enterprise mode (connect.js). This is the other one. It speaks
 * the same RPCs in the same proto3 JSON shapes, so the vocabulary and the caches
 * in index.js, the guards in server/auth.js and every route above them stay
 * exactly as they are.
 *
 * The answers are simple on purpose: one owner, one workspace, and the owner
 * holds every permission there is. Nobody else exists, so nobody else holds
 * anything. Mirrors are accepted and kept nowhere — there is no tree to grant
 * on. Anything index.js doesn't already ask answers `unimplemented`, so a new
 * question added later fails loudly here rather than quietly granting access.
 *
 * It reads nothing itself (server/hayat imports only config): server.js hands it
 * `state` — server/solo.js's in-memory copy of the `solo` setting — plus the
 * permission list, the token verifier and the workspace rename.
 */

import { HayatError } from './connect.js'

/**
 * @param {object} o
 * @param {() => {owner: object|null, workspace: {id: string, name: string}}} o.state
 * @param {string[]} o.permissions   every qualified key (permissions-catalog)
 * @param {(token: string) => Promise<object>} o.verifyToken   → JWT claims
 * @param {(name: string) => Promise<void>} o.renameWorkspace
 */
export function soloBackend({ state, permissions, verifyToken, renameWorkspace }) {
  const owner = () => state()?.owner || null
  const workspace = () => state()?.workspace || { id: '', name: '' }
  const isOwner = (id) => !!owner() && String(id) === owner().id

  // Hayat's shapes (proto3 JSON), as index.js reads them.
  const user = () => {
    const o = owner()
    return { id: o.id, email: o.email, name: o.name || '', zoneinfo: o.timezone || '', status: 'active', picture: '' }
  }
  const tenant = () => {
    const ws = workspace()
    return { id: ws.id, name: ws.name, slug: 'personal', ownerUserId: owner()?.id || '', nodeId: ws.id, memberCount: owner() ? 1 : 0 }
  }
  const resource = (r) => ({
    nodeId: `${r.type}:${r.externalId}`,
    type: r.type,
    externalId: String(r.externalId),
    name: r.name || String(r.externalId),
    tenantId: workspace().id,
    parentNodeId: '',
    ownerUserId: r.ownerUserId || owner()?.id || '',
  })
  const written = () => ({ tenantId: workspace().id, rev: '0' })

  const handlers = {
    'DirectoryService.BatchGetUsers': ({ ids = [] }) => ({ users: ids.some(isOwner) ? [user()] : [] }),
    'DirectoryService.ListUserTenants': ({ userId }) => ({ tenants: isOwner(userId) ? [tenant()] : [] }),
    'DirectoryService.ListTenantMembers': () => ({ members: owner() ? [{ user: user(), isOwner: true }] : [] }),
    // What the owner holds comes from owning everything; there are no grants to list.
    'DirectoryService.ListTenantGrants': () => ({ grants: [] }),
    'DirectoryService.UpdateTenant': async ({ name }) => {
      await renameWorkspace(name)
      return { tenant: tenant(), ...written() }
    },
    'AuthzService.PermissionsAt': ({ userId }) => ({ permissions: isOwner(userId) ? permissions : [], tenantId: workspace().id }),
    'AuthzService.LookupSubjects': ({ permission }) => ({
      subjects: owner() && permissions.includes(permission) ? [{ userId: owner().id, reason: { text: 'Owns this instance' } }] : [],
    }),
    'TreeService.GetResource': ({ resource: r = {} }) => ({ resource: resource(r) }),
    'TreeService.UpsertResource': (r) => ({ resource: resource(r), ...written() }),
    'TreeService.DeleteResource': () => written(),
  }

  return {
    solo: true,
    async call(service, method, body = {}) {
      const handler = handlers[`${service}.${method}`]
      if (!handler) throw new HayatError('unimplemented', `${service}.${method} is not available in solo mode`)
      return handler(body)
    },
    // Nothing changes behind this process's back, so there is nothing to follow.
    watch: null,
    verify: verifyToken,
    // What the browser needs before anyone is signed in (GET /api/auth/config).
    signInConfig: () => ({ mode: 'solo', setupRequired: !owner(), people: false }),
  }
}
