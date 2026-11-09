import type { CommandDoc } from '@/shared/ui/CommandDocView'
import { meetsVersion } from '@/shared/lib/version'
import { POSTGRES_REFERENCE } from './postgres'
import { SQLITE_REFERENCE } from './sqlite'
import type { SqlReference } from './types'

export type { SqlCommand, SqlReference } from './types'

// Keyed like DIALECT: an engine without an entry simply shows no reference.
const REFERENCES: Record<string, SqlReference> = {
  sqlite: SQLITE_REFERENCE,
  postgresql: POSTGRES_REFERENCE,
}

export const sqlReferenceFor = (type: string | undefined): SqlReference | null => (type && REFERENCES[type]) || null

// "3.35.0" → "3.35", "15" stays — the list's tag is a short label.
const shortVersion = (v: string) => v.replace(/\.0$/, '')

const needs = (ref: SqlReference, since: string, version: string) =>
  `Needs ${ref.engine} ${since} — this server runs ${version}`

/**
 * The reference panel's list: the catalog grouped, each entry tagged with the
 * release that introduced it and flagged when the connected server predates it.
 */
export function sqlReferenceGroups(ref: SqlReference, version: string | null) {
  return Object.entries(ref.groups).map(([group, label]) => ({
    label,
    commands: ref.commands
      .filter((c) => c.group === group)
      .map((c) => ({
        name: c.name,
        args: c.args,
        insert: c.insert,
        tag: c.since ? shortVersion(c.since) : undefined,
        unavailable: c.since && !meetsVersion(version, c.since) ? needs(ref, c.since, version!) : undefined,
      })),
  }))
}

/** One entry's docs for the reference panel, with the version facts filled in. */
export function sqlCommandDoc(ref: SqlReference, name: string, version: string | null): CommandDoc | null {
  const c = ref.commands.find((x) => x.name === name)
  if (!c) return null
  const facts = [
    { label: 'Available since', value: c.since ? `${ref.engine} ${c.since}` : `Every supported ${ref.engine} release` },
    ...(version ? [{ label: 'This server', value: `${ref.engine} ${version}` }] : []),
  ]
  return {
    name: c.name,
    syntax: c.args,
    summary: c.summary,
    engine: ref.engine,
    category: ref.groups[c.group],
    writes: c.writes,
    warning: c.since && !meetsVersion(version, c.since) ? `${needs(ref, c.since, version!)}, so it fails here.` : undefined,
    facts,
    details: c.details,
    options: c.options,
    returns: c.returns,
    examples: c.examples,
    notes: c.notes,
    link: c.doc ? { href: `${ref.docsBase}${c.doc}`, label: `${ref.engine} documentation` } : undefined,
  }
}
