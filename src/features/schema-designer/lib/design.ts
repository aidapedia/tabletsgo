// The *design* of a schema draft — everything about the diagram that isn't
// DDL: where each table sits, the group regions drawn around them, and the
// notes pinned to the canvas.
//
// The DDL alone was never the whole draft. Reopening one used to re-run dagre,
// so the arrangement someone had built by hand came back scattered; and there
// was nowhere at all to write down *why* a table looks the way it does. Both
// are this document: one JSON blob saved beside the SQL (drafts carry a
// `layout` column — see meta migration v19) and carried whole by the design
// export/import file.
//
// Everything here is read tolerantly (`normalizeLayout`): a layout is user
// data that has round-tripped through a file, and a diagram that loses a note
// is better than an editor that refuses to open.

/** A sticky note on the canvas — free text at a position, in a colour. */
export type SchemaNote = {
  id: string
  x: number
  y: number
  w: number
  h: number
  text: string
  color: string
}

/**
 * A group region as the design remembers it.
 *
 * In the console a group *is* a table folder, and the region is derived from
 * where its member tables sit — that is what makes it follow them around. The
 * design records the members anyway, plus the rectangle the region occupied,
 * so a design exported from one place still draws its groups somewhere with no
 * folders of its own (a from-scratch draft), and so a group whose members are
 * all hidden doesn't vanish.
 */
export type SchemaGroupLayout = {
  id: string
  name: string
  color: string | null
  tables: string[]
  x: number
  y: number
  w: number
  h: number
}

export type SchemaLayout = {
  version: number
  /** Table name -> canvas position. Names, not ids: a table *is* its name here. */
  tables: Record<string, { x: number; y: number }>
  notes: SchemaNote[]
  groups: SchemaGroupLayout[]
}

export const LAYOUT_VERSION = 1

// The note palette. Deliberately not FOLDER_COLORS: a note is a large filled
// panel rather than a dot, so these are the muted end of the same hues, legible
// under text in both themes. First entry is what a new note gets.
export const NOTE_COLORS = [
  '#eab308', // amber
  '#84cc16', // lime
  '#10b981', // emerald
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#a855f7', // purple
  '#ec4899', // pink
  '#ef4444', // red
  '#64748b', // slate
] as const

export const NOTE_DEFAULT_COLOR = NOTE_COLORS[0]
export const NOTE_MIN_W = 140
export const NOTE_MIN_H = 80
export const NOTE_DEFAULT_W = 220
export const NOTE_DEFAULT_H = 120

export const emptyLayout = (): SchemaLayout => ({ version: LAYOUT_VERSION, tables: {}, notes: [], groups: [] })

/** Nothing placed, nothing written — a draft that has never been arranged. */
export const isEmptyLayout = (layout: SchemaLayout | null | undefined) =>
  !layout || (!Object.keys(layout.tables).length && !layout.notes.length && !layout.groups.length)

const num = (value: any, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

let noteSeq = 0
/** Ids only have to be unique within one design, and they end up in node ids. */
export const newNoteId = () => `n${Date.now().toString(36)}${(noteSeq++).toString(36)}`

export function normalizeNote(raw: any): SchemaNote | null {
  if (!raw || typeof raw !== 'object') return null
  return {
    id: String(raw.id || newNoteId()),
    x: num(raw.x),
    y: num(raw.y),
    w: Math.max(NOTE_MIN_W, num(raw.w, NOTE_DEFAULT_W)),
    h: Math.max(NOTE_MIN_H, num(raw.h, NOTE_DEFAULT_H)),
    text: typeof raw.text === 'string' ? raw.text : '',
    color: typeof raw.color === 'string' && raw.color ? raw.color : NOTE_DEFAULT_COLOR,
  }
}

function normalizeGroup(raw: any): SchemaGroupLayout | null {
  if (!raw || typeof raw !== 'object' || !raw.id) return null
  return {
    id: String(raw.id),
    name: String(raw.name || 'Group'),
    color: typeof raw.color === 'string' && raw.color ? raw.color : null,
    tables: Array.isArray(raw.tables) ? raw.tables.filter((t: any) => typeof t === 'string') : [],
    x: num(raw.x),
    y: num(raw.y),
    w: Math.max(0, num(raw.w)),
    h: Math.max(0, num(raw.h)),
  }
}

/** Read a stored/imported layout into the shape the editor works with. */
export function normalizeLayout(raw: any): SchemaLayout {
  if (!raw || typeof raw !== 'object') return emptyLayout()
  const tables: SchemaLayout['tables'] = {}
  for (const [name, pos] of Object.entries<any>(raw.tables || {})) {
    if (!name || !pos || typeof pos !== 'object') continue
    tables[name] = { x: num(pos.x), y: num(pos.y) }
  }
  return {
    version: num(raw.version, LAYOUT_VERSION),
    tables,
    notes: (Array.isArray(raw.notes) ? raw.notes : []).map(normalizeNote).filter(Boolean) as SchemaNote[],
    groups: (Array.isArray(raw.groups) ? raw.groups : []).map(normalizeGroup).filter(Boolean) as SchemaGroupLayout[],
  }
}

// ---- The portable design file ----

/**
 * A whole schema design in one file: its DDL statements *and* its layout.
 *
 * Deliberately not the image export next to it — a PNG is a picture of the
 * diagram, this is the diagram. Importing one into another draft rebuilds the
 * tables, the groups, the notes and every position exactly as they were saved.
 */
export type SchemaDesignDoc = {
  kind: 'schema-design'
  version: number
  name: string
  /** The engine the DDL is written for; a mismatch on import is a warning, not a refusal. */
  dialect: string
  statements: string[]
  layout: SchemaLayout
}

export const DESIGN_KIND = 'schema-design'

export function buildDesignDoc({
  name,
  dialect,
  statements,
  layout,
}: {
  name: string
  dialect: string
  statements: string[]
  layout: SchemaLayout
}): SchemaDesignDoc {
  return {
    kind: DESIGN_KIND,
    version: LAYOUT_VERSION,
    name: name || 'schema',
    dialect: dialect || '',
    statements: statements.filter((s) => typeof s === 'string' && s.trim()),
    layout,
  }
}

/** Parse a design file. Throws with a readable message — the caller toasts it. */
export function parseDesignDoc(text: string): SchemaDesignDoc {
  let doc: any
  try {
    doc = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  if (!doc || doc.kind !== DESIGN_KIND) throw new Error('Not a schema design export file.')
  return {
    kind: DESIGN_KIND,
    version: num(doc.version, LAYOUT_VERSION),
    name: String(doc.name || 'schema'),
    dialect: String(doc.dialect || ''),
    statements: (Array.isArray(doc.statements) ? doc.statements : []).filter((s: any) => typeof s === 'string' && s.trim()),
    layout: normalizeLayout(doc.layout),
  }
}

/** Filename-safe slug for the downloaded design file. */
export const designFileName = (name: string) => `${(name || 'schema').replace(/[^\w-]+/g, '-').toLowerCase()}.design.json`
