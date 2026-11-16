// Facts the public site states that can be checked against the code mechanically, whatever the marker says.
// A change that shipped before the marker (or was never mapped) still shows up here.
//
// Today: the database engines. The code's list is server/db/index.js's `drivers`, labelled by
// server/module-registry.js; the site's is product.ts plus every sentence that lists engines.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Engines a competitor supports and Tabletsgo doesn't: a line naming one of these is about someone else.
const OTHER_ENGINES = /SQL Server|MariaDB|MongoDB|ClickHouse|CockroachDB|Oracle|DuckDB|Cassandra|DynamoDB/

// Lines that name some engines on purpose, not as "every engine Tabletsgo has". `file` is a path suffix.
const ALLOW = [
  { file: 'content/docs/configure/modules.mdx', line: /^\|/, why: 'the modules table groups engines by their settings, one row each' },
]

const read = (f) => readFileSync(f, 'utf8')
const block = (src, from, to) => src.slice(src.indexOf(from), to ? src.indexOf(to, src.indexOf(from)) : undefined)

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|mdx|html)$/.test(name)) out.push(p)
  }
  return out
}

/** The engines tabletsgo ships: [{ id, label, tables }]. `tables`: it has a table row limit, so it browses tables (SQL). */
export function shippedEngines(root) {
  const ids = [...block(read(join(root, 'server/db/index.js')), 'export const drivers', '}').matchAll(/^\s*(\w+):/gm)].map((m) => m[1])
  const registry = read(join(root, 'server/module-registry.js'))
  const meta = Object.fromEntries(
    [...registry.matchAll(/id:\s*'(\w+)',\s*kind:\s*'engine',\s*label:\s*'([^']+)'[^\n]*/g)].map((m) => [m[1], { label: m[2], tables: m[0].includes('TABLE_ROW_LIMIT') }]),
  )
  return ids.map((id) => ({ id, label: meta[id]?.label || id, tables: !!meta[id]?.tables }))
}

/** Every place the site disagrees with the shipped engines, as readable lines. */
export function checkEngines(root, docsRepo) {
  const problems = []
  const shipped = shippedEngines(root)
  const product = join(docsRepo, 'apps/tabletsgo/src/content/product.ts')
  const src = read(product)

  const supported = [...block(src, 'SUPPORTED_ENGINES', 'ENGINE_SUPPORT').matchAll(/id:\s*'(\w+)'/g)].map((m) => m[1])
  const planned = [...block(src, 'PLANNED_ENGINES', ']').matchAll(/id:\s*'(\w+)'/g)].map((m) => m[1])
  for (const { id, label } of shipped) {
    if (!supported.includes(id)) problems.push(`product.ts SUPPORTED_ENGINES has no '${id}' (${label} ships in server/db/)`)
    if (planned.includes(id)) problems.push(`product.ts PLANNED_ENGINES still lists '${id}', which ships`)
    if (!existsSync(join(docsRepo, `apps/tabletsgo/public/logos/${id}.svg`))) problems.push(`no logo at apps/tabletsgo/public/logos/${id}.svg`)
  }
  for (const id of supported) if (!shipped.some((e) => e.id === id)) problems.push(`product.ts SUPPORTED_ENGINES lists '${id}', which isn't in server/db/index.js`)
  for (const m of block(src, 'export const ENGINE_SUPPORT', 'PLANNED_ENGINES').matchAll(/label:\s*'([^']+)',\s*values:\s*\[([^\]]*)\]/g)) {
    const n = m[2].split(',').filter((v) => v.trim()).length
    if (n !== supported.length) problems.push(`product.ts ENGINE_SUPPORT '${m[1]}' has ${n} values for ${supported.length} engines`)
  }

  // Sentences that list Tabletsgo's engines, and none that only a competitor has. A line naming three or more
  // engines, one without tables among them, is the whole roster; a line naming only table engines is the SQL
  // ones (backups, the schema designer) and must name them all. Two names are too often a different fact (the
  // metadata store is SQLite or PostgreSQL), so those are left to the skill's grep step.
  const labels = shipped.map((e) => e.label)
  const sqlLabels = shipped.filter((e) => e.tables).map((e) => e.label)
  const files = [...walk(join(docsRepo, 'apps/tabletsgo/src')), ...walk(join(docsRepo, 'apps/aidapedia/src')), ...walk(join(docsRepo, 'packages/shared/src')),
    join(docsRepo, 'apps/tabletsgo/index.html'), join(docsRepo, 'apps/aidapedia/index.html')].filter(existsSync)
  for (const file of files) {
    if (file === product) continue
    read(file).split('\n').forEach((line, i) => {
      if (ALLOW.some((a) => file.endsWith(a.file) && a.line.test(line))) return
      const where = `${relative(docsRepo, file)}:${i + 1}`
      const named = labels.filter((l) => new RegExp(`\\b${l}\\b`).test(line))
      if (!OTHER_ENGINES.test(line) && !/screenshot|alt:/i.test(line)) {
        const sqlOnly = named.every((l) => sqlLabels.includes(l))
        const expected = sqlOnly ? sqlLabels : labels
        const missing = expected.filter((l) => !named.includes(l))
        if (named.length >= 3 && missing.length) {
          problems.push(`${where} lists ${named.join(', ')} — missing ${missing.join(', ')}${sqlOnly ? ' (the SQL engines)' : ''}`)
        }
      }
      // "Pick a competitor if you use X" where Tabletsgo supports X.
      if (/You use|Your database is|backups of/.test(line)) {
        const ours = labels.filter((l) => new RegExp(`\\b${l}\\b`).test(line))
        if (ours.length) problems.push(`${where} sends ${ours.join(', ')} users to a competitor, but Tabletsgo supports it`)
      }
    })
  }
  return problems
}
