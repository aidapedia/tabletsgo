import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'

// Modules below import the production metadata handle: isolate and migrate it first.
process.env.ENCRYPTION_KEY = 'hayat-test-key'
process.env.META_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tabletsgo-hayat-')), 'app.db')
process.env.HAYAT_WEB_CLIENT_ID = 'tabletsgo-web'
const { runMigrations } = await import('../server/migrator/index.js')
runMigrations({ log: () => {} })
const { MIGRATIONS } = await import('../server/migrator/legacy/sqlite.js')
const { addBundleAdmin, emptyBundle, exportHayatBundle } = await import('../server/migrator/hayat-export.js')
const { contractManifest, hayatKey, shortKeys } = await import('../server/permissions-catalog.js')
const hayat = await import('../server/hayat/index.js')
const auth = await import('../server/auth.js')
const { db: meta } = await import('../server/meta.js')
const { deleteWorkspaceCascade, getWorkspaceMember, listWorkspaceMembers, syncWorkspaceRows } = await import('../server/workspaces.js')

// ---- The export: old tables → a bundle in Hayat's terms -------------------------

// A database at legacy v22 — the shape every install had before the drop.
function legacyDb() {
  const db = new Database(':memory:')
  const ctx = { encryptSecret: (x) => x, encryptAppSetting: (x) => x }
  for (const step of MIGRATIONS) {
    db.transaction(() => {
      step.up(db, ctx)
      db.pragma(`user_version = ${step.version}`)
    })()
  }
  // What the Prisma migrations after the baseline added before the drop.
  db.exec('ALTER TABLE users ADD COLUMN timezone TEXT')
  return db
}

test('the export carries people, workspaces, groups, resources and grants over in Hayat terms', () => {
  const db = legacyDb()
  const run = (sql, ...args) => db.prepare(sql).run(...args)
  run("INSERT INTO users (id, username, password_hash, name, role, status, timezone) VALUES ('admin', 'admin@x.io', 'aa', 'Ada', 'admin', 'active', NULL)")
  run("INSERT INTO users (id, username, password_hash, name, role, status, timezone) VALUES ('olive', 'olive@x.io', 'bb', 'Olive', 'user', 'active', 'Asia/Jakarta')")
  run("INSERT INTO users (id, username, password_hash, name, role, status) VALUES ('mo', 'mo@x.io', 'cc', 'Mo', 'user', 'active')")
  run("INSERT INTO users (id, username, password_hash, name, role, status) VALUES ('pat', 'pat@x.io', '', 'Pat', 'user', 'pending')")
  run("INSERT INTO workspaces (id, name, settings, created_at) VALUES ('ws1', 'Acme', '{}', 1)")
  run("INSERT INTO workspaces (id, name, settings, created_at) VALUES ('ws2', 'Empty', '{}', 2)")
  run("INSERT OR IGNORE INTO resource_nodes (id, parent_id, kind, type, name, path, depth) VALUES ('root', NULL, 'group', 'application', 'Application', '/root', 0)")
  const node = (id, parent, kind, type, resourceId, ws, depth, owner = null) =>
    run('INSERT INTO resource_nodes (id, parent_id, kind, type, resource_id, name, owner_id, workspace_id, path, depth) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, parent, kind, type, resourceId, id, owner, ws, `/${id}`, depth)
  node('n-ws1', 'root', 'group', 'workspace', 'ws1', 'ws1', 1, 'olive')
  node('n-ws2', 'root', 'group', 'workspace', 'ws2', 'ws2', 1)
  node('n-promo', 'n-ws1', 'group', 'group', null, 'ws1', 2)
  node('n-c1', 'n-promo', 'resource', 'connection', 'c1', 'ws1', 3)
  node('n-c2', 'n-ws1', 'resource', 'connection', 'c2', 'ws1', 2)
  node('n-d1', 'n-c2', 'resource', 'dashboard', 'd1', 'ws1', 3)
  run("INSERT INTO connections (id, name, workspace_id, owner_id, type) VALUES ('c1', 'promo-db', 'ws1', 'olive', 'postgresql')")
  run("INSERT INTO connections (id, name, workspace_id, owner_id, type) VALUES ('c2', 'orders-db', 'ws1', 'mo', 'postgresql')")
  for (const [nodeId, userId] of [['n-ws1', 'olive'], ['n-ws1', 'mo'], ['n-ws1', 'pat'], ['n-promo', 'mo']]) {
    run('INSERT INTO node_members (id, node_id, user_id) VALUES (?, ?, ?)', `${nodeId}-${userId}`, nodeId, userId)
  }
  // A custom role that manages connections: in Hayat it must open them too.
  run("INSERT INTO roles (id, slug, name, builtin, applies_to) VALUES ('r-dba', 'dba', 'DBA', 0, '[\"workspace\",\"connection\",\"dashboard\"]')")
  run("INSERT INTO role_permissions (role_id, permission) VALUES ('r-dba', 'connections.manage'), ('r-dba', 'gone.permission')")
  const grant = (id, nodeId, type, principal, role) =>
    run('INSERT INTO resource_grants (id, node_id, principal_type, principal_id, role_slug, inherit) VALUES (?, ?, ?, ?, ?, 1)', id, nodeId, type, principal, role)
  grant('g1', 'n-ws1', 'user', 'olive', 'owner')
  grant('g2', 'n-ws1', 'user', 'mo', 'member')
  grant('g3', 'n-c2', 'user', 'mo', 'dba')
  grant('g4', 'n-d1', 'user', 'mo', 'dba')
  run("INSERT INTO connection_access (id, connection_id, principal_type, principal_id) VALUES ('a1', 'c2', 'user', 'pat'), ('a2', 'c1', 'node', 'n-ws1')")

  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name))
  const b = exportHayatBundle(db, (t) => tables.has(t))

  assert.equal(b.format, 'hayat-import')
  assert.equal(b.service.id, 'tabletsgo')
  assert.equal(b.service.contract, contractManifest())
  const olive = b.users.find((u) => u.id === 'olive')
  assert.deepEqual(olive, { id: 'olive', email: 'olive@x.io', name: 'Olive', passwordHash: '$sha256$bb', status: 'active', zoneinfo: 'Asia/Jakarta', admin: false })
  assert.equal(b.users.find((u) => u.id === 'pat').passwordHash, '', 'no password stays no password')
  assert.deepEqual(b.rootGrants, [{ userId: 'admin', role: 'tabletsgo.admin' }])

  assert.deepEqual(b.roles, [{
    key: 'custom:dba', name: 'DBA', description: '',
    permissions: ['tabletsgo.connections.manage', 'tabletsgo.connection.open'],
    appliesTo: ['hayat/tenant', 'tabletsgo/connection'],
  }])

  assert.equal(b.tenants.length, 1, 'a workspace nobody belongs to has no owner to give Hayat')
  assert.ok(b.skipped.some((s) => s.includes('Empty')))
  const t = b.tenants[0]
  assert.equal(t.ownerId, 'olive')
  assert.deepEqual(t.members.sort(), ['mo', 'olive', 'pat'])
  assert.deepEqual(t.groups, [{ key: 'n-promo', parent: '', name: 'n-promo', members: ['mo'] }])
  assert.deepEqual(t.resources, [
    { type: 'tabletsgo/connection', externalId: 'c1', name: 'promo-db', parent: 'n-promo', ownerId: 'olive' },
    { type: 'tabletsgo/connection', externalId: 'c2', name: 'orders-db', parent: '', ownerId: 'mo' },
  ])
  const grants = t.grants.map((g) => `${g.on} ${g.principal} ${g.role}`).sort()
  assert.deepEqual(grants, [
    'resource:tabletsgo/connection:c1 tenant tabletsgo.connection-user',
    'resource:tabletsgo/connection:c2 user:mo custom:dba',
    'resource:tabletsgo/connection:c2 user:pat tabletsgo.connection-user',
    'tenant user:olive hayat.tenant-admin',
    'tenant user:olive tabletsgo.owner',
  ])
  assert.ok(b.skipped.some((s) => s.includes('dashboard')), 'a grant on a dashboard is reported, not silently lost')
})

// ---- The guards, against a fake Hayat ----------------------------------------------

// What a fake Hayat holds: tokens → users, tenants and the qualified permissions
// each (user, node) has. Counts calls, so caching is visible.
function fakeHayat() {
  const state = {
    calls: 0,
    tokens: { 'tok-olive': 'olive', 'tok-mo': 'mo', 'tok-gone': 'gone' },
    users: {
      olive: { id: 'olive', email: 'olive@x.io', name: 'Olive', zoneinfo: 'Asia/Jakarta', status: 'active' },
      mo: { id: 'mo', email: 'mo@x.io', name: 'Mo', status: 'active' },
      gone: { id: 'gone', email: 'gone@x.io', name: 'Gone', status: 'disabled' },
    },
    tenants: { olive: [{ id: 'ws1', name: 'Acme', slug: 'acme', ownerUserId: 'olive', nodeId: 'n-ws1', memberCount: 2 }], mo: [{ id: 'ws1', name: 'Acme', slug: 'acme', nodeId: 'n-ws1', memberCount: 2 }] },
    perms: {
      'olive|hayat/tenant|ws1': ['tabletsgo.storage.manage', 'hayat.members.manage', 'tabletsgo.unknown.thing'],
      'olive|tabletsgo/connection|c1': ['tabletsgo.connection.open', 'tabletsgo.connections.manage'],
      'mo|tabletsgo/connection|c1': [],
      'olive|root': ['tabletsgo.instance.manage'],
    },
    rosters: { ws1: [['olive', true], ['mo', false]] },
    grants: {
      ws1: [
        { userId: 'olive', resource: { nodeId: 'n-ws1', type: 'hayat/tenant', name: 'Acme' }, via: 'owner', inherit: true },
        { userId: 'olive', resource: { nodeId: 'n-ws1', type: 'hayat/tenant', name: 'Acme' }, via: 'user', role: 'tabletsgo.owner', roleName: 'Workspace owner (tabletsgo)', inherit: true },
        { userId: 'mo', resource: { nodeId: 'n-ws1', type: 'hayat/tenant', name: 'Acme' }, via: 'everyone', role: 'tabletsgo.connection-user', roleName: 'Connection user', inherit: true },
        { userId: 'mo', resource: { nodeId: 'n-c1', type: 'tabletsgo/connection', externalId: 'c1', name: 'promo-db' }, via: 'group', role: 'tabletsgo.connection-manager', roleName: 'Connection manager', inherit: true, groupId: 'n-promo', groupName: 'Promo' },
      ],
    },
    upserts: [],
    deletes: [],
  }
  const key = (userId, r) => (r.nodeId === hayat.ROOT_NODE_ID ? `${userId}|root` : `${userId}|${r.type}|${r.externalId}`)
  const backend = {
    verify: async (token) => {
      if (!state.tokens[token]) throw new Error('signature verification failed')
      return { sub: state.tokens[token], client_id: 'tabletsgo-web' }
    },
    call: async (service, method, body) => {
      state.calls++
      switch (`${service}.${method}`) {
        case 'DirectoryService.BatchGetUsers':
          return { users: body.ids.map((id) => state.users[id]).filter(Boolean) }
        case 'DirectoryService.ListUserTenants':
          return { tenants: state.tenants[body.userId] || [] }
        case 'DirectoryService.ListTenantMembers':
          return { members: (state.rosters[body.tenantId] || []).map(([id, isOwner]) => ({ user: state.users[id], isOwner })) }
        case 'DirectoryService.ListTenantGrants':
          return { grants: state.grants[body.tenantId] || [] }
        case 'AuthzService.PermissionsAt':
          return { permissions: state.perms[key(body.userId, body.resource)] || [], tenantId: 'ws1', rev: '1' }
        case 'TreeService.UpsertResource':
          state.upserts.push(body)
          return { rev: '2', tenantId: 'ws1', resource: { nodeId: 'n-new', type: body.type, externalId: body.externalId, name: body.name } }
        case 'TreeService.DeleteResource':
          state.deletes.push(body)
          return { rev: '3', tenantId: 'ws1' }
        default:
          throw new Error(`unexpected ${service}.${method}`)
      }
    },
  }
  return { state, backend }
}

const runMiddleware = async (token) => {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} }
  await auth.sessionMiddleware(req, {}, () => {})
  return req
}

const resStub = () => {
  const res = { statusCode: 200, body: null }
  res.status = (c) => ((res.statusCode = c), res)
  res.json = (b) => ((res.body = b), res)
  return res
}

test('a request is signed in by a Hayat token, and only an active account counts', async () => {
  const { backend } = fakeHayat()
  hayat.useHayatBackend(backend)
  const req = await runMiddleware('tok-olive')
  assert.deepEqual(auth.publicUser(req.authUser), { id: 'olive', email: 'olive@x.io', name: 'Olive', role: 'admin', timezone: 'Asia/Jakarta', picture: null })
  assert.equal((await runMiddleware('tok-mo')).authUser.role, 'user', 'admin is a grant at the root, not a column')
  assert.equal((await runMiddleware('tok-gone')).authUser, undefined, 'a disabled account is signed out')
  assert.equal((await runMiddleware('forged')).authUser, undefined)
  assert.equal((await runMiddleware(null)).authUser, undefined)
})

test('a token issued to another application is refused', async () => {
  const { backend } = fakeHayat()
  hayat.useHayatBackend({ ...backend, verify: async () => ({ sub: 'olive', client_id: 'someone-else', aud: ['someone-else'] }) })
  assert.equal((await runMiddleware('tok-olive')).authUser, undefined)
})

test('workspace guards ask Hayat by permission, in short keys', async () => {
  const { state, backend } = fakeHayat()
  hayat.useHayatBackend(backend)
  assert.equal(await auth.isMember('ws1', 'mo'), true)
  assert.equal(await auth.isMember('ws2', 'mo'), false)
  assert.deepEqual([...(await auth.permissionsIn('ws1', 'olive'))].sort(), ['members.manage', 'storage.manage'], 'unknown keys are dropped')

  const olive = (await runMiddleware('tok-olive')).authUser
  const res = resStub()
  assert.ok(await auth.requirePermission({ authUser: olive }, res, 'ws1', 'storage.manage'))
  const mo = (await runMiddleware('tok-mo')).authUser
  const denied = resStub()
  assert.equal(await auth.requirePermission({ authUser: mo }, denied, 'ws1', 'storage.manage'), null)
  assert.equal(denied.statusCode, 403)
  assert.equal(denied.body.error, 'You do not have permission to do that.', 'a member is told to ask, not that the workspace is missing')

  const ws = await auth.workspaceForUser('ws1', 'olive')
  assert.equal(ws.role, 'owner')
  assert.equal(ws.name, 'Acme')

  // Answers are cached: asking again costs nothing.
  const before = state.calls
  await auth.permissionsIn('ws1', 'olive')
  assert.equal(state.calls, before)
})

test('opening a connection is Hayat\'s connection.open; managing is ownership or connections.manage', async () => {
  const { backend } = fakeHayat()
  hayat.useHayatBackend(backend)
  const conn = { id: 'c1', workspaceId: 'ws1', ownerId: 'mo' }
  assert.equal(await auth.userCanAccessConnection(conn, 'olive'), true)
  assert.equal(await auth.userCanAccessConnection(conn, 'mo'), false)
  assert.equal(await auth.canManageConnection(conn, 'olive'), true, 'connections.manage at the connection')
  assert.equal(await auth.canManageConnection(conn, 'mo'), true, 'the owner')
  assert.equal(await auth.canManageConnection({ ...conn, ownerId: 'olive' }, 'mo'), false)
})

test('a resource write drops the cached answers for its tenant', async () => {
  const { state, backend } = fakeHayat()
  hayat.useHayatBackend(backend)
  assert.equal(await auth.userCanAccessConnection({ id: 'c1', workspaceId: 'ws1' }, 'mo'), false)
  state.perms['mo|tabletsgo/connection|c1'] = ['tabletsgo.connection.open']
  assert.equal(await auth.userCanAccessConnection({ id: 'c1', workspaceId: 'ws1' }, 'mo'), false, 'still cached')
  await hayat.upsertResource({ type: 'tabletsgo/connection', externalId: 'c9', name: 'x', parent: hayat.ref('hayat/tenant', 'ws1'), ownerId: 'mo' })
  assert.equal(await auth.userCanAccessConnection({ id: 'c1', workspaceId: 'ws1' }, 'mo'), true)
  assert.deepEqual(state.upserts.at(-1), { type: 'tabletsgo/connection', externalId: 'c9', name: 'x', parent: { type: 'hayat/tenant', externalId: 'ws1' }, ownerUserId: 'mo' })
})

test('an account whose sign-in name is not an email is left out, with what names it', () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE users (id TEXT, username TEXT, name TEXT, password_hash TEXT, status TEXT, role TEXT);
           CREATE TABLE workspaces (id TEXT, name TEXT, created_at TEXT);
           INSERT INTO users VALUES ('u-admin', 'admin', 'Admin', 'abc', 'active', 'admin'),
                                    ('u-ada', 'ada@example.com', 'Ada', 'def', 'active', 'admin');`)
  const b = exportHayatBundle(db, (t) => ['users', 'workspaces'].includes(t))
  assert.deepEqual(b.users.map((u) => u.email), ['ada@example.com'])
  assert.deepEqual(b.rootGrants.map((g) => g.userId), ['u-ada'])
  assert.match(b.skipped[0], /account "admin": its sign-in name isn't an email address/)
})

test('a fresh install names its first admin: a pending account holding tabletsgo\'s Admin role at the root', () => {
  const b = addBundleAdmin(emptyBundle(), '  Ada@Example.com ')
  assert.equal(b.users.length, 1)
  assert.deepEqual({ ...b.users[0], id: undefined }, { id: undefined, email: 'ada@example.com', name: '', passwordHash: '', status: 'pending', zoneinfo: '', admin: true })
  assert.deepEqual(b.rootGrants, [{ userId: b.users[0].id, role: 'tabletsgo.admin' }])

  // Someone the bundle already holds is promoted, never duplicated; asking twice changes nothing.
  addBundleAdmin(b, 'ada@example.com')
  assert.equal(b.users.length, 1)
  assert.equal(b.rootGrants.length, 1)
  assert.equal(addBundleAdmin(emptyBundle(), '').users.length, 0)
})

test('the catalog maps every route key to Hayat and back', () => {
  assert.equal(hayatKey('teams.manage'), 'hayat.groups.manage')
  assert.equal(hayatKey('connection.open'), 'tabletsgo.connection.open')
  assert.throws(() => hayatKey('made.up'))
  assert.deepEqual([...shortKeys(['tabletsgo.ssh.manage', 'billing.ledger.view'])], ['ssh.manage'])
  const contract = JSON.parse(contractManifest())
  assert.equal(contract.service, 'tabletsgo')
  assert.ok(contract.permissions.every((p) => !p.key.startsWith('tabletsgo.') && !p.key.startsWith('hayat.')), 'contract keys are written short')
  assert.ok(contract.permissions.every((p) => p.label), 'every permission carries the label Hayat\'s roles pages show')
  assert.deepEqual(contract.resource_types.find((t) => t.name === 'connection').access, { permission: 'connection.open', via_placement: true, requires_membership: true })
})

// ---- What tabletsgo keeps about a workspace -------------------------------------------

test('workspace rows follow Hayat\'s names, and removing a workspace takes everything tabletsgo held', async () => {
  await syncWorkspaceRows([{ id: 'ws-x', name: 'Old name' }])
  await syncWorkspaceRows([{ id: 'ws-x', name: 'New name' }])
  assert.equal((await meta().workspaces.findUnique({ where: { id: 'ws-x' } })).name, 'New name')

  await meta().connections.create({ data: { id: 'cx', data: '{}', workspace_id: 'ws-x' } })
  await meta().ssh_keys.create({ data: { id: 'kx', workspace_id: 'ws-x', name: 'k', public_key: 'ssh-ed25519 AAAA' } })
  await meta().ssh_gateways.create({ data: { id: 'gx', workspace_id: 'ws-x', name: 'g', host: 'h' } })
  await meta().storage_destinations.create({ data: { id: 'sx', workspace_id: 'ws-x', name: 's', bucket: 'b' } })
  await meta().schema_drafts.create({ data: { id: 'dx', workspace_id: 'ws-x', name: 'd', db_type: 'postgresql' } })
  assert.deepEqual(await deleteWorkspaceCascade('ws-x'), ['cx'])
  for (const table of ['connections', 'ssh_keys', 'ssh_gateways', 'storage_destinations', 'schema_drafts', 'workspaces']) {
    assert.equal(await meta()[table].count({ where: table === 'workspaces' ? { id: 'ws-x' } : { workspace_id: 'ws-x' } }), 0, table)
  }
})

test('members carry their workspace roles, and one member their whole access list', async () => {
  const { backend } = fakeHayat()
  hayat.useHayatBackend(backend)
  const members = await listWorkspaceMembers('ws1')
  const olive = members.find((m) => m.userId === 'olive')
  const mo = members.find((m) => m.userId === 'mo')
  // Ownership isn't a role; a grant on a connection isn't a workspace role.
  assert.deepEqual(olive.roles, [{ role: 'tabletsgo.owner', name: 'Workspace owner (tabletsgo)', via: 'user', groupName: null }])
  assert.equal(olive.isOwner, true)
  assert.deepEqual(mo.roles, [{ role: 'tabletsgo.connection-user', name: 'Connection user', via: 'everyone', groupName: null }])
  assert.deepEqual(olive.permissions, ['storage.manage', 'members.manage'], 'what the roles add up to, still from PermissionsAt')

  const detail = await getWorkspaceMember('ws1', 'mo')
  assert.equal(detail.email, 'mo@x.io')
  assert.deepEqual(detail.access, [
    { kind: 'workspace', id: 'n-ws1', name: 'Acme', via: 'everyone', role: 'tabletsgo.connection-user', roleName: 'Connection user', inherit: true, groupName: null },
    { kind: 'connection', id: 'c1', name: 'promo-db', via: 'group', role: 'tabletsgo.connection-manager', roleName: 'Connection manager', inherit: true, groupName: 'Promo' },
  ])
  assert.equal(await getWorkspaceMember('ws1', 'stranger'), null)
})
