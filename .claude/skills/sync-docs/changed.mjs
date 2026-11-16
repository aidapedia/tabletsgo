#!/usr/bin/env node
// What changed in tabletsgo since the public docs were last synced, and which docs pages to re-check.
//
//   node .claude/skills/sync-docs/changed.mjs              # since the commit in the docs' marker
//   node .claude/skills/sync-docs/changed.mjs --since v1.0.0
//   node .claude/skills/sync-docs/changed.mjs --mark       # record HEAD as synced (after the docs are updated)
//   node .claude/skills/sync-docs/changed.mjs --check      # only the drift check (facts.mjs), exit 1 on drift
//
// The docs repo is $TABLETSGO_DOCS_REPO, else ../aidapedia beside this repo. The marker is
// apps/tabletsgo/docs-sync.json in it. Read-only unless --mark.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { entriesFor, pagesFor, SITE_TARGETS } from './docs-map.mjs'
import { checkEngines } from './facts.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const DOCS_REPO = resolve(process.env.TABLETSGO_DOCS_REPO || join(ROOT, '../aidapedia'))
const DOCS_DIR = join(DOCS_REPO, 'apps/tabletsgo/src/content/docs')
const MARKER = join(DOCS_REPO, 'apps/tabletsgo/docs-sync.json')

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
const lines = (s) => s.split('\n').filter(Boolean)
const fail = (msg) => {
  console.error(msg)
  process.exit(1)
}

if (!existsSync(DOCS_DIR)) fail(`No docs at ${DOCS_DIR}. Clone aidapedia/aidapedia beside tabletsgo or set TABLETSGO_DOCS_REPO.`)

const args = process.argv.slice(2)
const head = git('rev-parse', 'HEAD')

// What the site states that the code contradicts right now, whatever changed since the marker.
function drift() {
  const problems = checkEngines(ROOT, DOCS_REPO)
  if (!problems.length) return console.log('Drift check: the site agrees with the engines the code ships.') || 0
  console.log(`Drift check — the site disagrees with the code (fix these whatever the marker says):\n  ${problems.join('\n  ')}`)
  return 1
}

if (args.includes('--check')) process.exit(drift())

if (args.includes('--mark')) {
  const dirty = lines(git('status', '--porcelain')).map((l) => l.slice(3)).filter((f) => entriesFor(f).length)
  if (dirty.length) console.warn(`warning: uncommitted changes in documented files, which this mark doesn't cover:\n  ${dirty.join('\n  ')}`)
  const marker = { repo: 'aidapedia/tabletsgo', commit: head, branch: git('rev-parse', '--abbrev-ref', 'HEAD'), syncedAt: new Date().toISOString().slice(0, 10) }
  writeFileSync(MARKER, JSON.stringify(marker, null, 2) + '\n')
  console.log(`Marked the docs as synced to ${head.slice(0, 7)} in ${MARKER}`)
  process.exit(0)
}

const sinceArg = args.indexOf('--since')
let since = sinceArg >= 0 ? args[sinceArg + 1] : null
if (!since) {
  if (!existsSync(MARKER)) fail(`No marker at ${MARKER}. Pass --since <ref> for the first sync.`)
  since = JSON.parse(readFileSync(MARKER, 'utf8')).commit
}
try {
  git('cat-file', '-e', `${since}^{commit}`)
} catch {
  fail(`${since} isn't a commit here (rebased or squashed away?). Pass --since <ref>, e.g. the merge-base with the main branch.`)
}

// Committed since the marker, plus what's still in the working tree, plus new untracked files.
const changed = [...new Set([...lines(git('diff', '--name-only', since)), ...lines(git('ls-files', '--others', '--exclude-standard'))])].sort()
const pages = pagesFor(changed)

console.log(`tabletsgo ${since.slice(0, 7)} → ${head.slice(0, 7)} (+ working tree)   docs: ${DOCS_DIR}\n`)
const log = git('log', '--oneline', `${since}..HEAD`)
if (log) console.log(`Commits:\n${log.replace(/^/gm, '  ')}\n`)

if (!pages.size) console.log('No documented file changed. Nothing to sync.')
const docs = [...pages].filter(([p]) => !p.startsWith('site:'))
const site = [...pages].filter(([p]) => p.startsWith('site:'))
const show = ([, { files, why }]) => {
  console.log(`    because: ${[...why].join('; ')}`)
  for (const f of files) console.log(`    changed: ${f}`)
}
if (docs.length) console.log('Docs pages (apps/tabletsgo/src/content/docs):')
for (const entry of docs) {
  console.log(`  ${entry[0]}.mdx`)
  show(entry)
}
if (site.length) console.log(`${docs.length ? '\n' : ''}Landing page (aidapedia repo):`)
for (const entry of site) {
  const target = SITE_TARGETS[entry[0].slice(5)]
  console.log(`  ${entry[0]} — ${target.what}`)
  for (const f of target.files) console.log(`    in: ${f}`)
  show(entry)
}

// Changes the map doesn't know about but that may still be user-facing: a new route, script or feature.
const unmapped = changed.filter((f) => !entriesFor(f).length && /^(server\.js|server\/|scripts\/(?!dev\/))/.test(f))
if (unmapped.length) console.log(`\nNot in the map (check whether a page describes them; add to docs-map.mjs if so):\n  ${unmapped.join('\n  ')}`)

console.log('')
drift()
