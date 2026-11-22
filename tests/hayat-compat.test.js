import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { HAYAT_RPCS, HAYAT_VERSION_FLOOR, MIN_HAYAT_VERSION, SOLO_ONLY, compatibility, versionAtLeast } from '../server/hayat/compat.js'

const ROOT = path.resolve(import.meta.dirname, '..')

// Every .js file under these folders that could talk to Hayat. Solo's backend
// only answers RPCs; it never sends one.
function sources() {
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.js') && !p.endsWith(path.join('hayat', 'solo-backend.js'))) out.push(p)
    }
  }
  walk(path.join(ROOT, 'server'))
  walk(path.join(ROOT, 'scripts'))
  out.push(path.join(ROOT, 'server.js'))
  return out
}

// `call('DirectoryService', 'GetUser'`, `callOpen(url, 'EnrollmentService', 'Enroll'`
// and a hand-written `${PKG}.WatchService/Watch` path.
const PATTERNS = [/call(?:Open)?\((?:[^,()]+,\s*)?'(\w+Service)',\s*'(\w+)'/g, /\$\{PKG\}\.(\w+Service)\/(\w+)/g]

function rpcsSent() {
  const found = new Map() // rpc → first file:line
  for (const file of sources()) {
    const text = fs.readFileSync(file, 'utf8')
    for (const re of PATTERNS) {
      for (const m of text.matchAll(re)) {
        const rpc = `${m[1]}.${m[2]}`
        if (!found.has(rpc)) found.set(rpc, `${path.relative(ROOT, file)}:${text.slice(0, m.index).split('\n').length}`)
      }
    }
  }
  return found
}

test('every RPC tabletsgo sends to Hayat says which Hayat release it needs', () => {
  const sent = rpcsSent()
  assert.ok(sent.size > 5, 'found the Hayat calls')
  for (const [rpc, where] of sent) {
    if (SOLO_ONLY.has(rpc)) continue
    assert.ok(
      HAYAT_RPCS[rpc],
      `${where} calls ${rpc}: add it to HAYAT_RPCS in server/hayat/compat.js with the release from its "// Since" line in Hayat's proto/hayat/authz/v1/authz.proto`,
    )
  }
  // And nothing listed that isn't called: a stale entry would raise the minimum for nothing.
  for (const rpc of Object.keys(HAYAT_RPCS)) assert.ok(sent.has(rpc), `HAYAT_RPCS lists ${rpc}, which nothing calls any more`)
})

test('the minimum is the newest release among the RPCs, never below the floor', () => {
  for (const [rpc, since] of Object.entries(HAYAT_RPCS)) {
    assert.match(since, /^\d+\.\d+\.\d+$/, rpc)
    assert.ok(versionAtLeast(MIN_HAYAT_VERSION, since), `${rpc} needs ${since}`)
  }
  assert.ok(versionAtLeast(MIN_HAYAT_VERSION, HAYAT_VERSION_FLOOR))
  assert.ok(Object.values(HAYAT_RPCS).includes(MIN_HAYAT_VERSION) || MIN_HAYAT_VERSION === HAYAT_VERSION_FLOOR)
})

test('what a reported version means', () => {
  const api = 'http://hayat-api:7443'
  assert.equal(compatibility(MIN_HAYAT_VERSION, api).ok, true)
  assert.equal(compatibility('v99.0.0', api).ok, true)
  assert.equal(compatibility('dev', api).ok, true, 'a build from source is new enough')
  const old = compatibility('1.1.1', api)
  assert.equal(old.ok, false)
  assert.match(old.problem, new RegExp(`needs Hayat ${MIN_HAYAT_VERSION.replaceAll('.', '\\.')} or newer.*runs 1\\.1\\.1\\. Upgrade Hayat first`))
  const silent = compatibility('', api)
  assert.equal(silent.ok, false)
  assert.equal(silent.running, null)
  assert.match(silent.problem, /doesn't report its version/)
})
