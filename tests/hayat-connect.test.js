import assert from 'node:assert/strict'
import test from 'node:test'
import { connectHayat } from '../server/hayat/connect.js'

// A Hayat auth role whose discovery names the public issuer, served at an
// internal address — what Docker looks like from the tabletsgo container.
function fakeFetch(seen) {
  return async (url, init) => {
    seen.push(String(url))
    if (String(url).endsWith('/.well-known/openid-configuration')) {
      return Response.json({
        issuer: 'http://localhost:8443',
        token_endpoint: 'http://localhost:8443/oauth/token',
        jwks_uri: 'http://localhost:8443/keys',
      })
    }
    if (String(url).endsWith('/oauth/token')) return Response.json({ access_token: 't', expires_in: 600 })
    return Response.json({ ok: true, auth: init?.headers?.Authorization })
  }
}

test('HAYAT_AUTH_URL: discovery and the token endpoint are reached internally, the issuer stays public', async (t) => {
  const seen = []
  t.mock.method(globalThis, 'fetch', fakeFetch(seen))
  const h = connectHayat({ issuer: 'http://localhost:8443', authUrl: 'http://hayat-auth:8443', apiUrl: 'http://hayat-api:7443', clientId: 'c', clientSecret: 's' })

  const d = await h.discover()
  assert.equal(d.issuer, 'http://localhost:8443')
  assert.equal(d.token_endpoint, 'http://hayat-auth:8443/oauth/token')
  assert.equal(d.jwks_uri, 'http://hayat-auth:8443/keys')

  const res = await h.call('AuthzService', 'Check', {})
  assert.equal(res.auth, 'Bearer t')
  assert.deepEqual(seen, [
    'http://hayat-auth:8443/.well-known/openid-configuration',
    'http://hayat-auth:8443/oauth/token',
    'http://hayat-api:7443/hayat.authz.v1.AuthzService/Check',
  ])
})

test('without HAYAT_AUTH_URL everything goes to the issuer, as published', async (t) => {
  const seen = []
  t.mock.method(globalThis, 'fetch', fakeFetch(seen))
  const h = connectHayat({ issuer: 'http://localhost:8443', apiUrl: 'http://hayat-api:7443', clientId: 'c', clientSecret: 's' })
  const d = await h.discover()
  assert.equal(d.token_endpoint, 'http://localhost:8443/oauth/token')
  assert.equal(seen[0], 'http://localhost:8443/.well-known/openid-configuration')
})
