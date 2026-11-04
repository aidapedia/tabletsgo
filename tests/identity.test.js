import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

// Google and GitHub sign-in, linking and registration: what a confirmed profile
// is allowed to do to an account. Providers are stubbed at `fetch`.

process.env.ENCRYPTION_KEY = 'identity-test-key'
process.env.META_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tabletsgo-identity-')), 'app.db')
const { runMigrations } = await import('../server/migrator/index.js')
runMigrations({ log: () => {} })
const { db } = await import('../server/meta.js')
const { loadModules, updateModules } = await import('../server/module-settings.js')
const { createUser, deleteUser, getUser, hasPassword, issueInviteToken, registerByEmail, verifyPassword } = await import('../server/users.js')
const { IdentityError, linkIdentity, listIdentities } = await import('../server/identity/identities.js')
const { acceptInvite, signIn, unlink } = await import('../server/identity/accounts.js')
const { adminProviders, clearProvider, enabledProviders, providerApp, saveProvider } = await import('../server/identity/providers.js')
const { fetchProfile, flowCookie, readFlowCookie, startFlow, takeFlow } = await import('../server/identity/oauth.js')
const { putOneTime, takeOneTime } = await import('../server/sessions/index.js')

await loadModules()

let n = 0
const profile = (over = {}) => {
  n += 1
  return { subject: `sub-${n}`, email: `person${n}@acme.com`, emailVerified: true, name: `Person ${n}`, ...over }
}
const refusedWith = (code) => (e) => e instanceof IdentityError && e.code === code
const row = (id) => db().users.findUnique({ where: { id } })

test('a profile matching nothing is refused while registration is off', async () => {
  await assert.rejects(signIn('google', profile()), refusedWith('not_linked'))
  assert.equal(await db().users.count({ where: { username: { startsWith: 'person' } } }), 0)
})

test('with registration on, a verified profile gets an active account with no password', async () => {
  await updateModules({ registration: { enabled: true } })
  const p = profile()
  const id = await signIn('google', p)
  const u = await row(id)
  assert.equal(u.status, 'active')
  assert.equal(u.name, p.name)
  assert.equal(u.invite_token, null)
  assert.equal(await hasPassword(id), false)
  assert.equal(await signIn('google', p), id, 'the second sign-in finds the link')
  await updateModules({ registration: { enabled: false } })
})

test('a matching active account is linked and signed in, keeping its password', async () => {
  const { user } = await createUser({ email: 'rina@acme.com', name: 'Rina', password: 'pw' })
  const id = await signIn('github', profile({ email: 'rina@acme.com', name: 'Someone Else' }))
  assert.equal(id, user.id)
  assert.equal((await row(id)).name, 'Rina')
  assert.ok(await verifyPassword(id, 'pw'))
  assert.equal((await listIdentities(id))[0].provider, 'github')
})

test('an unverified address never matches an account', async () => {
  const { user } = await createUser({ email: 'dimas@acme.com', name: 'Dimas', password: 'pw' })
  await assert.rejects(signIn('google', profile({ email: 'dimas@acme.com', emailVerified: false })), refusedWith('email_unverified'))
  await assert.rejects(signIn('google', profile({ email: null })), refusedWith('email_unverified'))
  assert.deepEqual(await listIdentities(user.id), [])
})

test('an instance admin is never linked by email alone, but can link explicitly', async () => {
  const { user } = await createUser({ email: 'root@acme.com', name: 'Root', password: 'pw', role: 'admin' })
  const p = profile({ email: 'root@acme.com' })
  await assert.rejects(signIn('google', p), refusedWith('not_linked'))
  await linkIdentity(user.id, 'google', p)
  assert.equal(await signIn('google', p), user.id)
})

test('signing in with a pending account\'s address accepts its invite', async () => {
  const { user } = await createUser({ email: 'sari@acme.com' })
  const id = await signIn('google', profile({ email: 'sari@acme.com', name: 'Sari' }))
  assert.equal(id, user.id)
  const u = await row(id)
  assert.equal(u.status, 'active')
  assert.equal(u.name, 'Sari')
  assert.equal(u.invite_token, null)
})

test('an invite can be accepted with an account under a different address', async () => {
  const { user, inviteToken } = await createUser({ email: 'andi@acme.com' })
  assert.equal(await acceptInvite(inviteToken, 'github', profile({ email: 'andi.personal@gmail.com' })), user.id)
  assert.equal((await row(user.id)).status, 'active')
  await assert.rejects(acceptInvite(inviteToken, 'github', profile()), refusedWith('invite_invalid'))
})

test('an expired invite is refused, and a taken identity leaves the invite usable', async () => {
  const { user: a, inviteToken: stale } = await createUser({ email: 'stale@acme.com' })
  await db().users.update({ where: { id: a.id }, data: { token_expires: Date.now() - 1 } })
  await assert.rejects(acceptInvite(stale, 'google', profile()), refusedWith('invite_invalid'))

  const { user: owner } = await createUser({ email: 'owner@acme.com', password: 'pw' })
  const p = profile()
  await linkIdentity(owner.id, 'google', p)
  const { user: b, inviteToken } = await createUser({ email: 'b@acme.com' })
  await assert.rejects(acceptInvite(inviteToken, 'google', p), refusedWith('already_linked'))
  const u = await row(b.id)
  assert.equal(u.status, 'pending')
  assert.equal(u.invite_token, inviteToken)
})

test('one account per provider, and an identity belongs to one account', async () => {
  const { user: a } = await createUser({ email: 'a1@acme.com', password: 'pw' })
  const { user: b } = await createUser({ email: 'b1@acme.com', password: 'pw' })
  const p = profile()
  await linkIdentity(a.id, 'google', p)
  await linkIdentity(a.id, 'google', p) // linking the same one again is a no-op
  await assert.rejects(linkIdentity(b.id, 'google', p), refusedWith('already_linked'))
  await assert.rejects(linkIdentity(a.id, 'google', profile()), refusedWith('provider_taken'))
})

test('the last way in cannot be unlinked; a password or second link frees it', async () => {
  await updateModules({ registration: { enabled: true } })
  const id = await signIn('google', profile())
  const [google] = await listIdentities(id)
  await assert.rejects(unlink(id, google.id), /only way to sign in/)
  await linkIdentity(id, 'github', profile())
  await unlink(id, google.id)
  assert.equal((await listIdentities(id)).length, 1)
  await updateModules({ registration: { enabled: false } })
})

test('nobody can unlink someone else\'s account', async () => {
  const { user: a } = await createUser({ email: 'a2@acme.com', password: 'pw' })
  const { user: b } = await createUser({ email: 'b2@acme.com', password: 'pw' })
  await linkIdentity(a.id, 'google', profile())
  const [mine] = await listIdentities(a.id)
  await assert.rejects(unlink(b.id, mine.id), /not found/)
  assert.equal((await listIdentities(a.id)).length, 1)
})

test('deleting an account removes its links, and the admin view shows them', async () => {
  const { user } = await createUser({ email: 'gone@acme.com', password: 'pw' })
  await linkIdentity(user.id, 'github', profile({ email: 'gone@gmail.com' }))
  const viewed = await getUser(user.id)
  assert.equal(viewed.hasPassword, true)
  assert.equal(viewed.identities[0].email, 'gone@gmail.com')
  assert.equal(viewed.password_hash, undefined)
  await deleteUser(user.id)
  assert.deepEqual(await listIdentities(user.id), [])
})

test('registering creates a pending account that holds no password until the link is used', async () => {
  const token = await registerByEmail({ email: 'new@acme.com', name: 'New' })
  assert.ok(token)
  const u = await db().users.findUnique({ where: { username: 'new@acme.com' } })
  assert.equal(u.status, 'pending')
  assert.equal(u.password_hash, '')
  assert.equal(u.invite_workspace, null)
  assert.equal(await registerByEmail({ email: 'new@acme.com' }), null, 'no second email inside a minute')
  await db().users.update({ where: { id: u.id }, data: { token_expires: Date.now() } })
  assert.ok(await registerByEmail({ email: 'new@acme.com' }), 'asking again later sends a new link')
})

test('registering an address that already has an account changes nothing', async () => {
  const { user } = await createUser({ email: 'taken@acme.com', name: 'Taken', password: 'pw' })
  assert.equal(await registerByEmail({ email: 'taken@acme.com', name: 'Attacker' }), null)
  assert.equal((await row(user.id)).name, 'Taken')
  assert.ok(await verifyPassword(user.id, 'pw'))
})

test('registering keeps a pending invite pointed at its workspace', async () => {
  const { user } = await createUser({ email: 'invited@acme.com' })
  await issueInviteToken(user.id, 'ws-1')
  await db().users.update({ where: { id: user.id }, data: { token_expires: Date.now() } })
  await registerByEmail({ email: 'invited@acme.com' })
  assert.equal((await row(user.id)).invite_workspace, 'ws-1')
})

test('a provider needs both credentials to turn on, and its secret stays on the server', async () => {
  await assert.rejects(saveProvider('google', { clientId: 'id', enabled: true }), /client ID and secret/)
  await saveProvider('google', { clientId: 'id', clientSecret: 'shh', enabled: true })
  const stored = await db().app_settings.findUnique({ where: { key: 'sign_in_providers' } })
  assert.ok(!stored.value.includes('shh'))
  const [google] = await adminProviders()
  assert.deepEqual([google.clientId, google.hasSecret, google.enabled], ['id', true, true])
  assert.equal(google.secret, undefined)
  assert.deepEqual(await enabledProviders(), [{ kind: 'google', label: 'Google' }])
  assert.equal((await providerApp('google')).clientSecret, 'shh')

  await saveProvider('google', { clientId: 'id2' })
  assert.equal((await providerApp('google')).clientSecret, 'shh', 'a blank secret keeps the saved one')
  await saveProvider('google', { enabled: false })
  assert.equal(await providerApp('google'), null)
  await assert.rejects(saveProvider('okta', {}), /Unknown/)
})

test('removing a provider leaves its links in place', async () => {
  await saveProvider('github', { clientId: 'gh', clientSecret: 's', enabled: true })
  const { user } = await createUser({ email: 'keep@acme.com', password: 'pw' })
  await linkIdentity(user.id, 'github', profile())
  await clearProvider('github')
  assert.equal((await listIdentities(user.id)).length, 1)
  assert.equal((await adminProviders()).find((p) => p.kind === 'github').linked >= 1, true)
})

const CALLBACK = 'https://tabletsgo.test/api/auth/oauth/callback'

test('a provider set up again needs its credentials again', async () => {
  await assert.rejects(saveProvider('github', { enabled: true }), /client ID and secret/)
  await saveProvider('github', { clientId: 'gh', clientSecret: 's', enabled: true })
})

test('a flow is single-use and bound to the browser that started it', async () => {
  await saveProvider('google', { clientId: 'cid', clientSecret: 'cs', enabled: true })
  const { url, binding } = await startFlow('google', { intent: 'login' }, CALLBACK)
  const sent = new URL(url)
  const state = sent.searchParams.get('state')
  assert.equal(sent.searchParams.get('client_id'), 'cid')
  assert.equal(sent.searchParams.get('redirect_uri'), CALLBACK)
  assert.equal(sent.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(sent.searchParams.get('client_secret'), null)

  assert.equal(await takeFlow(state, 'someone-elses-cookie'), null)
  assert.equal(await takeFlow(state, binding), null, 'a failed attempt burns the state')

  const again = await startFlow('google', { intent: 'link', userId: 'u1' }, CALLBACK)
  const flow = await takeFlow(new URL(again.url).searchParams.get('state'), again.binding)
  assert.equal(flow.userId, 'u1')
  assert.equal(await takeFlow(new URL(again.url).searchParams.get('state'), again.binding), null)
})

test('a provider that is off refuses to start', async () => {
  await saveProvider('google', { enabled: false })
  await assert.rejects(startFlow('google', { intent: 'login' }, CALLBACK), refusedWith('provider_off'))
  await saveProvider('google', { enabled: true })
})

test('a one-time record can be taken once', async () => {
  await putOneTime('code-1', { userId: 'u' }, 60_000)
  assert.deepEqual(await takeOneTime('code-1'), { userId: 'u' })
  assert.equal(await takeOneTime('code-1'), null)
  assert.equal(await takeOneTime(undefined), null)
})

const stubFetch = (routes) => {
  const seen = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init })
    const body = routes[String(url)]
    return new Response(JSON.stringify(body ?? { error: 'nope' }), { status: body ? 200 : 400 })
  }
  return { seen, restore: () => (globalThis.fetch = original) }
}

const FLOW = { verifier: 'v', callbackUrl: CALLBACK }

test('Google: the profile comes from the token and userinfo endpoints', async () => {
  const f = stubFetch({
    'https://oauth2.googleapis.com/token': { access_token: 'at' },
    'https://openidconnect.googleapis.com/v1/userinfo': { sub: '123', email: 'Rina@Acme.com', email_verified: true, name: 'Rina' },
  })
  try {
    const p = await fetchProfile({ ...FLOW, kind: 'google' }, 'code')
    assert.deepEqual(p, { subject: '123', email: 'rina@acme.com', emailVerified: true, name: 'Rina' })
    const body = f.seen[0].init.body
    assert.equal(body.get('grant_type'), 'authorization_code')
    assert.equal(body.get('code_verifier'), 'v')
    assert.equal(f.seen[1].init.headers.Authorization, 'Bearer at')
  } finally {
    f.restore()
  }
})

test('GitHub: only the primary address counts, verified or not', async () => {
  const f = stubFetch({
    'https://github.com/login/oauth/access_token': { access_token: 'at' },
    'https://api.github.com/user': { id: 42, login: 'rina', name: null },
    'https://api.github.com/user/emails': [
      { email: 'old@acme.com', primary: false, verified: true },
      { email: 'rina@acme.com', primary: true, verified: false },
    ],
  })
  try {
    const p = await fetchProfile({ ...FLOW, kind: 'github' }, 'code')
    assert.deepEqual(p, { subject: '42', email: 'rina@acme.com', emailVerified: false, name: 'rina' })
  } finally {
    f.restore()
  }
})

test('GitHub: a refused code is an error even though it answers 200', async () => {
  const f = stubFetch({ 'https://github.com/login/oauth/access_token': { error: 'bad_verification_code', error_description: 'expired' } })
  try {
    await assert.rejects(fetchProfile({ ...FLOW, kind: 'github' }, 'code'), /expired/)
  } finally {
    f.restore()
  }
})

test('the flow cookie is HttpOnly and readable among others', () => {
  const set = flowCookie('abc', { secure: true })
  assert.match(set, /^tg_oauth=abc; Path=\/api\/auth\/oauth; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/)
  assert.match(flowCookie('', { secure: false }), /Max-Age=0$/)
  assert.equal(readFlowCookie({ headers: { cookie: 'a=1; tg_oauth=abc; b=2' } }), 'abc')
  assert.equal(readFlowCookie({ headers: {} }), null)
})
