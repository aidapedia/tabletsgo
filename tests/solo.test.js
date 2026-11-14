import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'

// Modules below import the production metadata handle: isolate and migrate it first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabletsgo-solo-'))
process.env.ENCRYPTION_KEY = 'solo-test-key'
process.env.META_DB = path.join(dir, 'app.db')
delete process.env.HAYAT_ISSUER
delete process.env.TABLETSGO_MODE

const { migrateAndResolveMode } = await import('../server/migrator/index.js')
const { setMode } = await import('../server/mode.js')
setMode(migrateAndResolveMode({ log: () => {} }))
const { MIGRATIONS } = await import('../server/migrator/legacy/sqlite.js')
const identity = await import('../server/migrator/identity.js')
const { exportSoloBundle } = await import('../server/migrator/hayat-export.js')
const { HAYAT_KEYS, hayatKey } = await import('../server/permissions-catalog.js')
const { soloBackend } = await import('../server/hayat/solo-backend.js')
const hayat = await import('../server/hayat/index.js')
const auth = await import('../server/auth.js')
const solo = await import('../server/solo.js')
const { hashPassword, sha256, verifyPassword } = await import('../server/crypto.js')

const quiet = () => {}
const tablesOf = (db) => new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name))

// The production wiring (server.js), against the migrated test store.
await solo.loadSolo()
hayat.useHayatBackend(soloBackend({ state: solo.current, permissions: HAYAT_KEYS, verifyToken: solo.verifyAccess, renameWorkspace: solo.renameWorkspace }))

// ---- Boot ---------------------------------------------------------------------------

test('a new instance with no Hayat boots solo, with a workspace and no owner yet', () => {
  assert.equal(solo.current().owner, null)
  assert.ok(solo.current().workspace.id)
  assert.equal(solo.current().workspace.name, 'Personal')
  assert.deepEqual(hayat.signInConfig(), { mode: 'solo', setupRequired: true, people: false })
  assert.equal(hayat.consoleLink('/account'), null)
})

// ---- Setup, sign-in and tokens ------------------------------------------------------------

let owner
let tokens

test('setup needs the code from the log, a real email and an 8-character password', async () => {
  const code = solo.announceSetup(quiet)
  await assert.rejects(solo.setup({ code: 'wrong', email: 'dev@example.com', password: 'correct-horse' }, 'a'), { status: 403 })
  await assert.rejects(solo.setup({ code, email: 'not-an-email', password: 'correct-horse' }, 'a'), { status: 400 })
  await assert.rejects(solo.setup({ code, email: 'dev@example.com', password: 'short' }, 'a'), { status: 400 })
  owner = await solo.setup({ code: ` ${code.toUpperCase()} `, name: 'Dev', email: 'Dev@Example.com', password: 'correct-horse' }, 'a')
  assert.equal(owner.email, 'dev@example.com')
  assert.match(owner.passwordHash, /^\$scrypt\$/)
  await assert.rejects(solo.setup({ code, email: 'x@y.io', password: 'correct-horse' }, 'a'), { status: 409 })
  assert.equal(hayat.signInConfig().setupRequired, false)
})

test('the owner signs in with email and password; anything else is a 401', async () => {
  await assert.rejects(solo.signIn({ email: 'dev@example.com', password: 'nope' }, 'b'), { status: 401 })
  await assert.rejects(solo.signIn({ email: 'other@example.com', password: 'correct-horse' }, 'b'), { status: 401 })
  const signedIn = await solo.signIn({ email: 'DEV@example.com', password: 'correct-horse' }, 'b')
  assert.equal(signedIn.id, owner.id)
  tokens = await solo.issueTokens(signedIn)
  assert.equal(tokens.expiresIn, solo.ACCESS_TTL_S)
})

test('five failed attempts in a minute lock that address out, even with the right password', async () => {
  for (let i = 0; i < 5; i++) await assert.rejects(solo.signIn({ email: 'dev@example.com', password: 'bad' }, 'c'), { status: 401 })
  await assert.rejects(solo.signIn({ email: 'dev@example.com', password: 'correct-horse' }, 'c'), { status: 429 })
  assert.ok(await solo.signIn({ email: 'dev@example.com', password: 'correct-horse' }, 'elsewhere'))
})

test('the access token is the Bearer the guards accept; the refresh token is not', async () => {
  const { userId } = await hayat.verifyAccessToken(tokens.accessToken)
  assert.equal(userId, owner.id)
  await assert.rejects(hayat.verifyAccessToken(tokens.refreshToken))
  const fresh = await solo.refresh(tokens.refreshToken)
  assert.ok(fresh.accessToken)
  await assert.rejects(solo.refresh(tokens.accessToken), { status: 401 })
})

test('the owner is the instance admin and holds every permission in the workspace', async () => {
  const req = { headers: { authorization: `Bearer ${tokens.accessToken}` } }
  await auth.sessionMiddleware(req, {}, () => {})
  assert.equal(req.authUser.id, owner.id)
  assert.equal(req.authUser.role, 'admin')
  const wsId = solo.current().workspace.id
  assert.ok(await auth.isMember(wsId, owner.id))
  for (const key of ['workspace.manage', 'connections.create', 'storage.manage', 'workspace.delete']) assert.ok(await auth.can(wsId, owner.id, key), key)
  assert.ok(await auth.userCanAccessConnection({ id: 'c1', workspaceId: wsId }, owner.id))
  // Nobody else exists, so nobody else holds anything.
  assert.equal(await auth.isMember(wsId, 'stranger'), false)
  assert.equal(await auth.can(wsId, 'stranger', 'workspace.manage'), false)
  assert.equal(await hayat.check('stranger', hayatKey('connection.open'), hayat.ref('tabletsgo/connection', 'c1')), false)
})

test('mirrors are accepted and kept nowhere; an unknown question fails loudly', async () => {
  const r = await hayat.upsertResource({ type: 'tabletsgo/connection', externalId: 'c1', name: 'orders', parent: hayat.ref('hayat/tenant', 'x'), ownerId: owner.id })
  assert.equal(r.externalId, 'c1')
  await hayat.updateResource({ type: 'tabletsgo/connection', externalId: 'c1', name: 'orders-2', workspaceId: 'x' })
  await hayat.deleteResource('tabletsgo/connection', 'c1')
  const backend = soloBackend({ state: solo.current, permissions: HAYAT_KEYS, verifyToken: solo.verifyAccess, renameWorkspace: solo.renameWorkspace })
  await assert.rejects(backend.call('AuthzService', 'Grant', {}), { code: 'unimplemented' })
})

test('the workspace is renamed through Hayat’s vocabulary, and the cached name follows', async () => {
  const wsId = solo.current().workspace.id
  assert.equal((await hayat.userTenants(owner.id))[0].name, 'Personal')
  await hayat.renameTenant(wsId, 'Side projects')
  assert.equal((await hayat.userTenants(owner.id))[0].name, 'Side projects')
  await assert.rejects(hayat.renameTenant(wsId, '  '), { status: 400 })
})

test('an account change shows up on the next request, not after a cache TTL', async () => {
  await solo.updateAccount({ name: 'Dev Two', timezone: 'Asia/Jakarta' })
  const u = await hayat.getUser(owner.id)
  assert.equal(u.name, 'Dev Two')
  assert.equal(u.timezone, 'Asia/Jakarta')
  await assert.rejects(solo.updateAccount({ email: 'nope' }), { status: 400 })
})

test('a password change ends every other session and hands this one new tokens', async () => {
  await assert.rejects(solo.changePassword({ current: 'wrong-one', next: 'battery-staple' }, 'd'), { status: 403 })
  const next = await solo.changePassword({ current: 'correct-horse', next: 'battery-staple' }, 'd')
  await assert.rejects(hayat.verifyAccessToken(tokens.accessToken), /expired/)
  await assert.rejects(solo.refresh(tokens.refreshToken), { status: 401 })
  assert.ok(await hayat.verifyAccessToken(next.accessToken))
  tokens = next
})

test('signing out everywhere ends every session', async () => {
  await solo.signOut({ everywhere: true })
  await assert.rejects(hayat.verifyAccessToken(tokens.accessToken), /expired/)
})

test('the refresh cookie is httpOnly, strict, scoped to the solo routes, and reads back', () => {
  const cookie = solo.refreshCookie('abc', { secure: true })
  for (const part of ['HttpOnly', 'SameSite=Strict', 'Path=/api/auth/solo', 'Secure']) assert.ok(cookie.includes(part), part)
  assert.match(solo.refreshCookie('', { secure: false }), /Max-Age=0/)
  assert.equal(solo.readRefreshCookie({ headers: { cookie: `a=1; ${solo.REFRESH_COOKIE}=abc.def=; b=2` } }), 'abc.def=')
})

test('in enterprise mode every solo route answers 404', async () => {
  setMode('enterprise')
  try {
    await assert.rejects(solo.signIn({ email: 'dev@example.com', password: 'battery-staple' }), { status: 404 })
    await assert.rejects(solo.setup({}), { status: 404 })
    await assert.rejects(solo.refresh('x'), { status: 404 })
    assert.equal(solo.announceSetup(quiet), null)
  } finally {
    setMode('solo')
  }
})

// ---- Passwords --------------------------------------------------------------------------------

test('passwords: scrypt with a salt, and a v1.0 hash verified once and flagged', async () => {
  const a = await hashPassword('pw-12345')
  assert.notEqual(a, await hashPassword('pw-12345'))
  assert.deepEqual(await verifyPassword('pw-12345', a), { ok: true, legacy: false })
  assert.deepEqual(await verifyPassword('nope', a), { ok: false, legacy: false })
  assert.deepEqual(await verifyPassword('old-pass', `$sha256$${sha256('old-pass')}`), { ok: true, legacy: true })
  assert.deepEqual(await verifyPassword('x', 'garbage'), { ok: false, legacy: false })
})

// ---- The mode, decided and recorded ----------------------------------------------------------

function freshStore() {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER); CREATE TABLE workspaces (id TEXT, name TEXT, settings TEXT, created_at INTEGER); CREATE TABLE connections (id TEXT, name TEXT, workspace_id TEXT, owner_id TEXT); CREATE TABLE storage_destinations (id TEXT, name TEXT, workspace_id TEXT)')
  return db
}
const env = (setting = '', hayatIssuer = '') => ({ setting, hayatIssuer })

test('mode: env first, then the store, then HAYAT_ISSUER decides', () => {
  const a = freshStore()
  assert.equal(identity.resolveIdentity(a, { log: quiet, env: env() }), 'solo')
  assert.equal(identity.readSetting(a, 'identity').mode, 'solo')
  assert.ok(identity.readSetting(a, 'solo').workspace.id)
  // Recorded: a later boot with no env keeps it, even with HAYAT_ISSUER around.
  assert.equal(identity.resolveIdentity(a, { log: quiet, env: env('', 'https://auth.example.com') }), 'solo')

  const b = freshStore()
  assert.equal(identity.resolveIdentity(b, { log: quiet, env: env('', 'https://auth.example.com') }), 'enterprise')
  assert.equal(identity.readSetting(b, 'solo'), null)
})

test('mode: an enterprise instance never boots solo, whatever the env says', () => {
  const db = freshStore()
  identity.resolveIdentity(db, { log: quiet, env: env('enterprise') })
  assert.throws(() => identity.resolveIdentity(db, { log: quiet, env: env('solo') }), /enterprise mode/)
  // With the env gone it stays enterprise (and server.js then asks for HAYAT_*).
  assert.equal(identity.resolveIdentity(db, { log: quiet, env: env() }), 'enterprise')
})

test('mode: a database that ran under Hayat before modes existed counts as enterprise', () => {
  const db = freshStore()
  db.prepare("INSERT INTO workspaces (id, name) VALUES ('t1', 'Acme')").run()
  assert.throws(() => identity.resolveIdentity(db, { wasHayat: true, log: quiet, env: env('solo') }), /enterprise mode/)
  assert.equal(identity.resolveIdentity(db, { wasHayat: true, log: quiet, env: env() }), 'enterprise')
  // …but an empty one has nothing to protect.
  assert.equal(identity.resolveIdentity(freshStore(), { wasHayat: true, log: quiet, env: env() }), 'solo')
})

test('mode: solo → enterprise writes the Hayat import bundle beside the data', () => {
  const db = freshStore()
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tabletsgo-bundle-'))
  identity.resolveIdentity(db, { log: quiet, env: env('solo'), bundleDir: out })
  const s = identity.readSetting(db, 'solo')
  identity.writeSetting(db, 'solo', { ...s, owner: { id: 'u1', email: 'dev@example.com', name: 'Dev', timezone: null, passwordHash: '$scrypt$x' } })
  db.prepare("INSERT INTO connections (id, name, workspace_id, owner_id) VALUES ('c1', 'orders', ?, 'u1')").run(s.workspace.id)
  assert.equal(identity.resolveIdentity(db, { log: quiet, env: env('enterprise'), bundleDir: out }), 'enterprise')
  const files = fs.readdirSync(out).filter((f) => f.startsWith('hayat-import-'))
  assert.equal(files.length, 1)
  const bundle = JSON.parse(fs.readFileSync(path.join(out, files[0]), 'utf8'))
  assert.equal(bundle.users[0].id, 'u1')
  assert.equal(bundle.users[0].status, 'pending')
  assert.equal(bundle.tenants[0].id, s.workspace.id)
  assert.deepEqual(bundle.tenants[0].resources.map((r) => r.externalId), ['c1'])
})

// ---- A v1.0 install moving to solo --------------------------------------------------------------

function legacyDb() {
  const db = new Database(':memory:')
  const ctx = { encryptSecret: (x) => x, encryptAppSetting: (x) => x }
  for (const step of MIGRATIONS) {
    db.transaction(() => {
      step.up(db, ctx)
      db.pragma(`user_version = ${step.version}`)
    })()
  }
  const run = (sql, ...args) => db.prepare(sql).run(...args)
  run("INSERT INTO workspaces (id, name, settings, created_at) VALUES ('ws1', 'Acme', '{}', 1)")
  run("INSERT INTO workspaces (id, name, settings, created_at) VALUES ('ws2', 'Side', '{}', 2)")
  run("INSERT INTO connections (id, name, workspace_id, owner_id, type) VALUES ('c1', 'a', 'ws1', 'ada', 'sqlite')")
  run("INSERT INTO connections (id, name, workspace_id, owner_id, type) VALUES ('c2', 'b', 'ws2', 'mo', 'sqlite')")
  return db
}
const addUser = (db, id, email, hash = 'aa') =>
  db.prepare("INSERT INTO users (id, username, password_hash, name, role, status) VALUES (?, ?, ?, ?, 'admin', 'active')").run(id, email, hash, id)

test('v1.0 with one account: it becomes the owner, keeps its id, and the workspaces fold into the oldest', () => {
  const db = legacyDb()
  addUser(db, 'ada', 'ada@x.io', sha256('old-pass'))
  addUser(db, 'admin', 'admin') // the old seeded account: not an email, so not a person to keep
  assert.equal(identity.captureSoloOwner(db, quiet, { soloOwner: '' }), 'ada')
  const s = identity.readSetting(db, 'solo')
  assert.equal(s.owner.email, 'ada@x.io')
  assert.equal(s.owner.passwordHash, `$sha256$${sha256('old-pass')}`)
  assert.deepEqual(s.workspace, { id: 'ws1', name: 'Acme' })
  assert.deepEqual(db.prepare('SELECT DISTINCT workspace_id AS w, owner_id AS o FROM connections').all(), [{ w: 'ws1', o: 'ada' }])
  assert.deepEqual(db.prepare('SELECT id FROM workspaces').all(), [{ id: 'ws1' }])
  assert.ok(tablesOf(db).has('users'), 'the drop migration removes the old tables, not this')
})

test('v1.0 with several accounts: refuses without SOLO_OWNER, keeps the named one with it', () => {
  const db = legacyDb()
  addUser(db, 'ada', 'ada@x.io')
  addUser(db, 'mo', 'mo@x.io')
  assert.throws(() => identity.captureSoloOwner(db, quiet, { soloOwner: '' }), /2 accounts.*SOLO_OWNER/s)
  assert.equal(identity.readSetting(db, 'solo'), null, 'nothing changes when it refuses')
  assert.throws(() => identity.captureSoloOwner(db, quiet, { soloOwner: 'nobody@x.io' }), /isn't one of/)
  assert.equal(identity.captureSoloOwner(db, quiet, { soloOwner: 'mo@x.io' }), 'mo')
  assert.equal(identity.readSetting(db, 'solo').owner.id, 'mo')
})

test('the solo bundle: a v1.0 hash Hayat can read arrives active, a scrypt one pending', () => {
  const db = legacyDb()
  addUser(db, 'ada', 'ada@x.io', sha256('old-pass'))
  identity.captureSoloOwner(db, quiet, { soloOwner: '' })
  const tables = tablesOf(db)
  const b = exportSoloBundle(db, (t) => tables.has(t))
  assert.equal(b.users[0].status, 'active')
  assert.equal(b.users[0].passwordHash, `$sha256$${sha256('old-pass')}`)
  assert.deepEqual(b.rootGrants, [{ userId: 'ada', role: 'tabletsgo.admin' }])
  assert.deepEqual(b.tenants[0].grants.map((g) => g.role), ['hayat.tenant-admin', 'tabletsgo.owner'])
  assert.deepEqual(b.tenants[0].resources.map((r) => r.externalId).sort(), ['c1', 'c2'])
})
