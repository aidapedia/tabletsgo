import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

// An enterprise instance with Hayat's addresses but no credentials: it enrolls
// with a code, the way the setup page does. Hayat is faked at the fetch level.
const ISSUER = 'https://auth.example.com'
const API = 'http://hayat-api:7443'
process.env.ENCRYPTION_KEY = 'enrollment-test-key'
process.env.META_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tabletsgo-enroll-')), 'app.db')
process.env.TABLETSGO_MODE = 'enterprise'
process.env.HAYAT_ISSUER = ISSUER
process.env.HAYAT_API_URL = API
delete process.env.PUBLIC_URL
const { runMigrations } = await import('../server/migrator/index.js')
runMigrations({ log: () => {} })
const hayat = await import('../server/hayat/index.js')
const enrollment = await import('../server/hayat-enrollment.js')
const { getSetting, setSetting } = await import('../server/app-settings.js')
const { APP_SETTINGS_KEY, encryptSecret } = await import('../server/crypto.js')

// What server.js does at boot: nothing stored yet, so not enrolled.
assert.equal(await enrollment.connectStored(), null)

const CODE = 'hye_' + 'a'.repeat(43)
const quiet = () => {}

// A Hayat that knows one code. `secrets` are the API secrets it accepts.
function fakeHayat({ serviceId = 'tabletsgo', registers = true, enrollError = null, down = false } = {}) {
  const hz = { secrets: new Set(), enrolls: [], tokens: [] }
  hz.fetch = async (url, init = {}) => {
    url = String(url)
    if (down) throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') })
    const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : {}
    if (url === `${API}/hayat.authz.v1.EnrollmentService/InspectEnrollment`) {
      if (body.code !== CODE) return Response.json({ code: 'failed_precondition', message: "this enrollment code isn't valid" }, { status: 400 })
      return Response.json({ serviceId, displayName: 'Tabletsgo', registers, madeByEmail: 'ada@example.com', madeByName: 'Ada', expiresAt: '2026-11-22T00:00:00Z', issuer: ISSUER })
    }
    if (url === `${API}/hayat.authz.v1.EnrollmentService/Enroll`) {
      hz.enrolls.push(body)
      if (enrollError) return Response.json(enrollError, { status: 400 })
      const secret = `secret-${hz.enrolls.length}`
      hz.secrets = new Set([secret])
      return Response.json({ serviceId, clientId: 'c_api', clientSecret: secret, webClientId: 'c_web', issuer: ISSUER, registered: registers, contractVersion: 9, warnings: [] })
    }
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({ issuer: ISSUER, token_endpoint: `${ISSUER}/oauth/token`, jwks_uri: `${ISSUER}/keys` })
    }
    if (url === `${ISSUER}/oauth/token`) {
      const secret = decodeURIComponent(Buffer.from(init.headers.Authorization.slice(6), 'base64').toString().split(':')[1])
      hz.tokens.push(secret)
      if (!hz.secrets.has(secret)) return Response.json({ error: 'invalid_client' }, { status: 401 })
      return Response.json({ access_token: `token-for-${secret}`, expires_in: 600 })
    }
    if (url.endsWith('.SchemaService/PublishContract')) return Response.json({ version: 9, status: 'active' })
    if (url.endsWith('.WatchService/Watch')) return new Response(null, { status: 503 })
    if (url.endsWith('.DirectoryService/BatchGetUsers')) return Response.json({ users: [] })
    return Response.json({ code: 'not_found', message: url }, { status: 404 })
  }
  return hz
}

test.after(() => hayat.stopHayat())

test('a new enterprise instance asks for an enrollment code', () => {
  const config = hayat.signInConfig()
  assert.equal(config.mode, 'enterprise')
  assert.equal(config.clientId, null)
  assert.deepEqual(config.setup, { reason: 'new' })
  const state = hayat.enrollmentState()
  assert.equal(state.enrolled, false)
  assert.equal(state.open, true)
  assert.equal(state.issuer, ISSUER)
})

test('inspecting a code shows what it would do, and refuses what it must', async (t) => {
  const hz = fakeHayat()
  t.mock.method(globalThis, 'fetch', hz.fetch)
  const preview = await enrollment.inspect(`  ${CODE} `)
  assert.equal(preview.registers, true)
  assert.deepEqual(preview.madeBy, { email: 'ada@example.com', name: 'Ada' })
  assert.equal(preview.issuerMatches, true)

  await assert.rejects(enrollment.inspect('not-a-code'), { status: 400, message: /starts with hye_/ })
  await assert.rejects(enrollment.inspect('hye_' + 'b'.repeat(43)), { status: 400, message: /isn't valid/ })

  t.mock.method(globalThis, 'fetch', fakeHayat({ serviceId: 'billing' }).fetch)
  await assert.rejects(enrollment.inspect(CODE), { status: 400, message: /for "billing", not tabletsgo/ })

  t.mock.method(globalThis, 'fetch', fakeHayat({ down: true }).fetch)
  await assert.rejects(enrollment.inspect(CODE), { status: 502, message: /Can't reach Hayat's API/ })
})

test('a refused code stores nothing', async (t) => {
  const hz = fakeHayat({ enrollError: { code: 'failed_precondition', message: 'this enrollment code was already used' } })
  t.mock.method(globalThis, 'fetch', hz.fetch)
  await assert.rejects(enrollment.enroll({ code: CODE, address: 'https://db.example.com' }, { log: quiet }), { status: 400, message: /already used/ })
  await assert.rejects(enrollment.enroll({ code: CODE, adminEmail: 'nope', address: 'https://db.example.com' }, { log: quiet }), /email address/)
  assert.deepEqual(await getSetting('hayat'), {})
  assert.equal(hayat.enrollmentState().enrolled, false)
})

test('enrolling stores sealed credentials and starts using them', async (t) => {
  const hz = fakeHayat()
  t.mock.method(globalThis, 'fetch', hz.fetch)
  const res = await enrollment.enroll({ code: CODE, adminEmail: 'dana@example.com', address: 'https://db.example.com/setup?x=1' }, { actor: null, log: quiet })
  assert.deepEqual(res, { registered: true, contractVersion: 9, warnings: [], address: 'https://db.example.com' })

  // What tabletsgo sent: its contract, address and admin.
  const sent = hz.enrolls[0]
  assert.equal(sent.code, CODE)
  assert.equal(sent.appUrl, 'https://db.example.com')
  assert.equal(sent.adminRole, 'tabletsgo.admin')
  assert.equal(sent.adminEmail, 'dana@example.com')
  assert.match(sent.manifest, /tabletsgo/)

  // Stored with the secret sealed, and read back in the clear.
  const stored = await getSetting('hayat')
  assert.equal(stored.clientId, 'c_api')
  assert.notEqual(stored.clientSecret, 'secret-1')
  assert.deepEqual(await enrollment.storedCredentials(), { clientId: 'c_api', clientSecret: 'secret-1', webClientId: 'c_web' })

  // Signing in works now: the console gets the web client, no setup page.
  const config = hayat.signInConfig()
  assert.equal(config.clientId, 'c_web')
  assert.equal(config.setup, null)
  const state = hayat.enrollmentState()
  assert.equal(state.enrolled, true)
  assert.equal(state.open, false)
  await hayat.checkCredentials()

  // And Hayat's API is called with the new credentials.
  await hayat.getUsers(['someone'])
  assert.equal(hz.tokens.at(-1), 'secret-1')
  const status = await enrollment.status()
  assert.equal(status.namespace, 'tabletsgo')
  assert.equal(status.address, 'https://db.example.com')
  assert.equal(status.registered, true)
})

test('credentials Hayat refuses reopen the setup page, and newer stored ones are picked up', async (t) => {
  const hz = fakeHayat()
  t.mock.method(globalThis, 'fetch', hz.fetch)
  // Hayat rotated the secret (another replica re-enrolled): it now accepts only secret-2,
  // which that replica wrote to the shared store.
  hz.secrets = new Set(['secret-2'])
  await setSetting('hayat', { ...(await getSetting('hayat')), clientSecret: encryptSecret('secret-2', APP_SETTINGS_KEY) })
  // This replica notices when it next needs a token: a restart here, or the
  // current token running out.
  hayat.useCredentials({ clientId: 'c_api', clientSecret: 'secret-1', webClientId: 'c_web' })
  await assert.rejects(hayat.getUsers(['someone-else']), /refused/)
  assert.equal(hayat.enrollmentState().rejected, true)
  assert.deepEqual(hayat.signInConfig().setup, { reason: 'rejected' })

  // The reload runs in the background; the next call uses the stored secret.
  await new Promise((r) => setTimeout(r, 20))
  await hayat.getUsers(['third'])
  assert.equal(hz.tokens.at(-1), 'secret-2')
  assert.equal(hayat.enrollmentState().rejected, false)
  assert.equal(hayat.signInConfig().setup, null)
})

test('a code for a tabletsgo Hayat already knows rotates its secret', async (t) => {
  const hz = fakeHayat({ registers: false })
  t.mock.method(globalThis, 'fetch', hz.fetch)
  const res = await enrollment.enroll({ code: CODE, address: 'https://db.example.com' }, { log: quiet })
  assert.equal(res.registered, false)
  assert.equal(hz.enrolls[0].adminEmail, '')
  assert.equal((await enrollment.storedCredentials()).clientSecret, 'secret-1')
})
