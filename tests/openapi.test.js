import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'

// server/openapi.yaml is the API's only documentation, so nothing but this
// stops it drifting from the routes server.js actually serves.

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const spec = parse(read('server/openapi.yaml'))
const METHODS = ['get', 'post', 'put', 'patch', 'delete']

const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  METHODS.filter((method) => item[method]).map((method) => ({ method, path, op: item[method] })))
const name = ({ method, path }) => `${method.toUpperCase()} ${path}`

// `app.all` is only as specific as "some method": the handler says which it takes.
const served = [...read('server.js').matchAll(/^app\.(get|post|put|patch|delete|all)\(\s*(\[[^\]]*\]|'[^']*')/gm)]
  .flatMap(([, method, paths]) => [...paths.matchAll(/'([^']+)'/g)]
    .map(([, path]) => ({ method, path: path.replace(/:([A-Za-z_]+)/g, '{$1}') })))

test('every route server.js serves is documented', () => {
  const missing = served
    .filter(({ method, path }) => (method === 'all' ? !METHODS.some((m) => spec.paths[path]?.[m]) : !spec.paths[path]?.[method]))
    .map(name)
  assert.deepEqual(missing, [])
})

test('every documented operation is a route server.js serves', () => {
  const routes = new Set(served.map(name))
  const allPaths = new Set(served.filter((r) => r.method === 'all').map((r) => r.path))
  const stale = operations.filter((o) => !routes.has(name(o)) && !allPaths.has(o.path)).map(name)
  assert.deepEqual(stale, [])
})

test('every operation can be read and tried', () => {
  const tags = new Set(spec.tags.map((t) => t.name))
  for (const { method, path, op } of operations) {
    const id = name({ method, path })
    assert.ok(op.summary, `${id} has no summary`)
    assert.ok(op.tags?.length && op.tags.every((t) => tags.has(t)), `${id} has an undeclared tag`)
    assert.ok(Object.keys(op.responses).some((code) => /^[23]/.test(code)), `${id} documents no success`)
    const declared = (op.parameters || []).filter((p) => p.in === 'path').map((p) => p.name).sort()
    const used = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    assert.deepEqual(declared, used, `${id} path parameters`)
  }
})

test('every $ref resolves', () => {
  const refs = [...read('server/openapi.yaml').matchAll(/\$ref: "?#\/([^"\n]+)/g)].map((m) => m[1])
  assert.ok(refs.length > 0)
  for (const ref of new Set(refs)) {
    const target = ref.split('/').reduce((node, key) => node?.[key], spec)
    assert.ok(target, `#/${ref} does not resolve`)
  }
})
