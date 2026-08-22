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

/**
 * The database's schema as the draft last saw it — its own copy of the tables
 * and foreign keys the canvas draws underneath the staged DDL.
 *
 * A linked draft used to read this from the live database every time it opened,
 * which meant the diagram was never really the draft's: it changed under you
 * when someone else ran DDL, and a draft that couldn't reach its database drew
 * nothing at all. So the draft stores it, and re-reading is an action someone
 * takes — "Sync schema" in the editor — rather than something that happens on
 * every open. `syncedAt` is when that read happened, and it is also what tells
 * the editor a *newer* snapshot has arrived (see SchemaEditor).
 *
 * The two lists are the `/diagram` response's, kept as the db layer hands them
 * over: this is a copy of that answer, not a second shape for it.
 */
export type SchemaSnapshot = {
  tables: any[]
  foreignKeys: any[]
  syncedAt: number
}

export type SchemaLayout = {
  version: number
  /** Table name -> canvas position. Names, not ids: a table *is* its name here. */
  tables: Record<string, { x: number; y: number }>
  /**
   * Table name -> the order its columns are drawn in.
   *
   * Only the *drawn* order, and only where the DDL can't say it: a staged
   * CREATE TABLE is rewritten when its columns are dragged (the order becomes
   * the statement's), but neither Postgres nor SQLite can move a column of a
   * table that already exists — so for a committed table the arrangement is
   * the design's, like a position or a note. A name the map doesn't mention is
   * a column added since it was written and keeps its natural place at the end
   * (see `orderColumns`).
   */
  columns: Record<string, string[]>
  notes: SchemaNote[]
  groups: SchemaGroupLayout[]
  /** The synced schema, or null for a draft with no database behind it. */
  schema: SchemaSnapshot | null
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

export const emptyLayout = (): SchemaLayout => ({ version: LAYOUT_VERSION, tables: {}, columns: {}, notes: [], groups: [], schema: null })

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
  const columns: SchemaLayout['columns'] = {}
  for (const [name, order] of Object.entries<any>(raw.columns || {})) {
    if (!name || !Array.isArray(order)) continue
    const names = order.filter((c: any) => typeof c === 'string' && c)
    if (names.length) columns[name] = names
  }
  return {
    version: num(raw.version, LAYOUT_VERSION),
    tables,
    columns,
    notes: (Array.isArray(raw.notes) ? raw.notes : []).map(normalizeNote).filter(Boolean) as SchemaNote[],
    groups: (Array.isArray(raw.groups) ? raw.groups : []).map(normalizeGroup).filter(Boolean) as SchemaGroupLayout[],
    schema: normalizeSnapshot(raw.schema),
  }
}

/**
 * Read a stored snapshot back, or answer null.
 *
 * Read as tolerantly as everything else here, with one rule that isn't
 * tolerance: a snapshot with no tables *and* no foreign keys is null. The
 * difference between "this draft has never been synced" and "it was synced and
 * the database was empty" is not worth a stored shape — both mean the canvas
 * has nothing of its own to draw, and null is what makes the editor go and
 * read it.
 */
export function normalizeSnapshot(raw: any): SchemaSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const tables = Array.isArray(raw.tables) ? raw.tables.filter((t: any) => t && typeof t === 'object' && t.name) : []
  const foreignKeys = Array.isArray(raw.foreignKeys) ? raw.foreignKeys.filter((f: any) => f && typeof f === 'object') : []
  if (!tables.length && !foreignKeys.length) return null
  return { tables, foreignKeys, syncedAt: num(raw.syncedAt, Date.now()) }
}

/** Build a snapshot from a `/diagram` response. Empty in, null out. */
export const schemaSnapshot = (diagram: any, syncedAt = Date.now()): SchemaSnapshot | null =>
  normalizeSnapshot({ tables: diagram?.tables, foreignKeys: diagram?.foreignKeys, syncedAt })

/**
 * Draw a table's columns in the order the design remembers.
 *
 * Tolerant in both directions, because the two lists drift apart on their own:
 * a column the order doesn't mention was added after the arrangement was made
 * (staged, or synced from the database) and keeps its natural place at the end,
 * and a name in the order that no longer exists is simply ignored. Returns the
 * given array unchanged when there is nothing to apply, so it stays a stable
 * dependency of whatever memo built it.
 */
export function orderColumns<T extends { name: string }>(columns: T[], order?: string[] | null): T[] {
  if (!order || order.length === 0 || columns.length < 2) return columns
  const rank = new Map(order.map((name, i) => [name, i]))
  return columns
    .map((c, i) => ({ c, key: rank.has(c.name) ? (rank.get(c.name) as number) : order.length + i }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.c)
}

/** The same list with the item at `from` lifted out and dropped in at `to`. */
export function moveColumn<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items
  const next = items.slice()
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}

/**
 * The same design, with no schema of its own.
 *
 * A snapshot describes *one* database, so it must not follow a design anywhere
 * else: linking or unlinking a draft changes which database is behind it (or
 * removes it entirely), and an exported design file is the diagram someone
 * drew, not a copy of the tables it was drawn over. Each of those strips it,
 * and the editor then reads the schema fresh where there is one to read.
 */
export const withoutSchemaSnapshot = (layout: SchemaLayout): SchemaLayout => ({ ...layout, schema: null })

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
