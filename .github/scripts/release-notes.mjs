// Drafts the release notes for one version: docs/releases/v<version>.md.
//
//   node .github/scripts/release-notes.mjs 1.2.0
//
// Run by release.yml on the release line before the version bump is committed,
// so the draft lands in the release PR and is read (and edited) before merging;
// docker-release.yml then publishes it as the GitHub Release body, and the
// website's changelog (aidapedia packages/shared/src/lib/releases.ts) reads it
// from there.
//
// The prose — summary, highlights, upgrading — is written by DeepSeek from what
// changed since the previous tag. The "All changes" list is built from git, never
// by the model, so every link is real. Without DEEPSEEK_API_KEY, or if the call
// fails, the file still gets the list and a placeholder to fill in by hand: a
// release is never blocked on the model.
//
// Same shape as hayat's .github/scripts/release-notes.mjs — keep the two in step.
//
// Env: DEEPSEEK_API_KEY (optional), DEEPSEEK_MODEL (default deepseek-chat),
//      GITHUB_REPOSITORY (owner/name), GH_TOKEN (optional: PR titles + bodies for the model).
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const version = (process.argv[2] ?? '').replace(/^v/, '')
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: release-notes.mjs X.Y.Z')
  process.exit(1)
}
const repo = process.env.GITHUB_REPOSITORY ?? 'aidapedia/tabletsgo'
const repoUrl = `https://github.com/${repo}`
const outFile = `docs/releases/v${version}.md`

// Paths whose diffs tell a reader what changed for them, most telling first (the
// budget runs out from the end); everything else is described by the commit
// messages and the diff stat.
const USER_FACING = [
  'README.md',
  '.env.example',
  'docker-compose.yml',
  'docker-compose.enterprise.yml',
  'prisma',
  'server/config.js',
  'docs/CONFIGURATION.md',
  'docs/FEATURES.md',
  'server/openapi.yaml',
]
const DIFF_BUDGET = 60_000   // characters of user-facing diff sent to the model
const BODY_BUDGET = 2_000    // characters per PR/commit body
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904' // git's empty tree: the base of a first release
const SKIP = /^(release|chore)(\(|:|\s)/i

const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}
const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text)

// The newest tag reachable from HEAD; none means this is the first release.
const previous = git('describe', '--tags', '--abbrev=0', '--match', 'v*.*.*', 'HEAD')
const range = previous ? `${previous}..HEAD` : 'HEAD'

// ── What changed ────────────────────────────────────────────────────────────
const records = (format, ...args) =>
  git('log', `--format=${format}%x1e`, ...args, range)
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => r.split('\x1f'))

async function pullRequest(number) {
  if (!process.env.GH_TOKEN) return null
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}`, {
      headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' },
    })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

// The change list is one line per commit, including the commits inside a merged
// PR; merge commits themselves are left out. PRs are still read — their titles and
// bodies tell the model what a group of commits was for.
const prs = []
for (const [, subject, body] of records('%H%x1f%s%x1f%b', '--merges')) {
  const number = subject.match(/^Merge pull request #(\d+)/)?.[1]
  if (number) prs.push({ number, title: (body ?? '').split('\n')[0].trim() || subject })
}
const commits = []
for (const [sha, subject, body] of records('%H%x1f%s%x1f%b', '--no-merges')) {
  // A squash merge ("title (#12)") names its PR; the commit stays in the list.
  const squashed = subject.match(/^(.*) \(#(\d+)\)$/)
  if (squashed) prs.push({ number: squashed[2], title: squashed[1] })
  commits.push({ sha, subject, body: (body ?? '').trim() })
}
for (const pr of prs) {
  const data = await pullRequest(pr.number)
  pr.title = data?.title ?? pr.title
  pr.body = (data?.body ?? '').trim()
}

const shown = prs.filter((pr) => !SKIP.test(pr.title))
const direct = commits.filter((c) => !SKIP.test(c.subject))

// The site's changelog reads this line shape (aidapedia
// packages/shared/src/lib/releases.ts): `* [type: subject](<commit>)`.
const allChanges = direct.map((c) => `* [${c.subject}](${repoUrl}/commit/${c.sha})`).join('\n')

// ── The model's draft ───────────────────────────────────────────────────────
function prompt() {
  const changes = [
    ...shown.map((pr) => `PR #${pr.number}: ${pr.title}\n${clip(pr.body, BODY_BUDGET)}`),
    ...direct.map((c) => `Commit ${c.sha.slice(0, 7)}: ${c.subject}\n${clip(c.body, BODY_BUDGET)}`),
  ].join('\n\n')
  let budget = DIFF_BUDGET
  const diffs = []
  for (const path of USER_FACING) {
    if (budget <= 0) break
    const diff = git('diff', previous || EMPTY_TREE, 'HEAD', '--', path)
    if (!diff) continue
    diffs.push(clip(diff, budget))
    budget -= diff.length
  }
  const stat = git('diff', '--stat=160', previous || EMPTY_TREE, 'HEAD')
  return [
    `Product: Tabletsgo — a self-hosted, team-friendly database console (browse data, write queries, design schemas, automate workflows, back up to S3), shipped as one Docker image.`,
    `Release: v${version}${previous ? ` (previous: ${previous})` : ' (first release)'}`,
    `## Changes\n${changes || '(no commit messages)'}`,
    `## Files changed\n${clip(stat, 8_000)}`,
    `## Diffs of user-facing files\n${diffs.join('\n') || '(none)'}`,
  ].join('\n\n')
}

const SYSTEM = `You write release notes for Tabletsgo's GitHub Releases and website changelog.
Readers are operators who run Tabletsgo with Docker and the people who use it to work with their databases.

Write Markdown in exactly this shape, and nothing else:

<one paragraph, 2-4 sentences: what this release is about and who should care>

## Highlights

### <feature name>
<2-4 sentences: what it does, why it matters, where to find it (a page or menu path, env var or API route in backticks when the input shows one)>

(one ### per notable change, most important first, at most 6; fold small fixes into one "### Fixes and polish" with a short bullet list)

## Upgrading

<what an operator must do: pull the new image and restart (the metadata database migrates on boot — mention new migrations under prisma/ if the input shows them), new, removed or renamed env vars, docker-compose changes, breaking API changes. If nothing beyond pulling, write "No action needed.">

Rules:
- Only state what the input shows. Never invent features, flags, numbers or links.
- Plain, specific language. No marketing words ("powerful", "seamless", "exciting"), no emoji.
- Do not add an "All changes" list or a title heading; they are added separately.`

async function draft() {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) return null
  const input = prompt()
  console.log(`Asking DeepSeek (${input.length} characters of input)…`)
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        temperature: 0.3,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: input },
        ],
      }),
      signal: AbortSignal.timeout(180_000),
    })
    if (!res.ok) throw new Error(`DeepSeek answered ${res.status}: ${clip(await res.text(), 300)}`)
    const text = (await res.json()).choices?.[0]?.message?.content?.trim()
    if (!text) throw new Error('DeepSeek returned no text')
    // Drop a stray list or title the model added anyway.
    return text.replace(/\n## All changes[\s\S]*$/i, '').replace(/^# .*\n+/, '').trim()
  } catch (err) {
    console.log(`::warning::Release notes not drafted by AI — ${err.message}`)
    return null
  }
}

const PLACEHOLDER = `<!-- Write a one-paragraph summary, then a "## Highlights" section with one "### " per notable change, then "## Upgrading". -->`

const prose = (await draft()) ?? PLACEHOLDER
const fullChangelog = previous ? `${repoUrl}/compare/${previous}...v${version}` : `${repoUrl}/commits/v${version}`
const notes = `${prose}\n\n## All changes\n\n${allChanges || '* Maintenance release.'}\n\n**Full Changelog**: ${fullChangelog}\n`

mkdirSync('docs/releases', { recursive: true })
writeFileSync(outFile, notes)
console.log(`Wrote ${outFile}`)
