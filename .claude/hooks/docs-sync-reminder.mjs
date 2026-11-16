#!/usr/bin/env node
// PostToolUse hook: when an edit touches a file the public docs describe (see
// .claude/skills/sync-docs/docs-map.mjs), name the docs pages to re-check and point at the sync-docs skill.
// Once per page per session, so a long change isn't nagged on every edit. Silent for every other edit.
//
// Reads the hook payload as JSON on stdin; prints a hook JSON result on stdout.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { pagesFor } from '../skills/sync-docs/docs-map.mjs'

let raw = ''
process.stdin.on('data', (chunk) => (raw += chunk))
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}')
    const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
    const abs = input.tool_input?.file_path
    if (!abs) return
    const file = relative(root, resolve(root, abs))
    if (file.startsWith('..')) return

    const pages = pagesFor([file])
    if (!pages.size) return

    // Remember which pages this session was already told about.
    const seenFile = join(tmpdir(), `tabletsgo-docs-sync-${String(input.session_id || 'nosession').replace(/[^\w-]/g, '')}.json`)
    const seen = new Set(existsSync(seenFile) ? JSON.parse(readFileSync(seenFile, 'utf8')) : [])
    const fresh = [...pages.keys()].filter((p) => !seen.has(p))
    if (!fresh.length) return
    writeFileSync(seenFile, JSON.stringify([...seen, ...fresh]))

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext:
            `${file} is described by the public site (aidapedia repo — docs pages, and site:* landing-page facts): ${fresh.join(', ')}. ` +
            'When this change is done, if it changed what a user sees, sets or runs, load the sync-docs skill and ' +
            'bring those pages in line. Internal refactors need no docs change.',
        },
      }),
    )
  } catch {
    // A malformed payload must never break the tool call — stay silent.
  }
})
