import { quoteIdent, unquoteIdent, type SqlDialect } from '@/shared/lib/sqlDialect'

/**
 * The index half of a table's schema: one editable model, the DDL that writes
 * it, and the parse back.
 *
 * Pure functions only — no React — because the rollback resolver
 * (`lib/rollback.ts`) rebuilds a dropped index from the live definition and
 * must not depend on a component.
 *
 * An index is never ALTERed: every engine we target creates and drops them, so
 * "edit this index" is a DROP followed by a CREATE, exactly like the FK editor
 * rewrites a constraint.
 */

/** One index as the panels edit it. `columns` is ordered — a composite index's leading column decides what it can serve. */
export type IndexModel = {
  id: string
  name: string
  columns: string[]
  unique: boolean
  /** Postgres access method (btree/hash/gin/…). Empty means the engine default; SQLite has none. */
  method: string
  /** Partial-index predicate, without the WHERE keyword. MySQL has no partial indexes. */
  where: string
}

/** One index as `getIndexes` returns it — see the driver contract in server/db/index.js. */
export type LiveIndex = {
  name: string
  algorithm?: string
  unique?: boolean
  columns?: string
  condition?: string
  primary?: boolean
  constraint?: boolean
  /** Why this index can't be written back from the model — MySQL's prefix lengths, expressions, FULLTEXT. */
  locked?: string
}

// Access methods worth offering. Postgres only: SQLite has one index kind and
// InnoDB one worth choosing, so the picker is hidden rather than filled with a
// single choice.
export const INDEX_METHODS = [
  { value: '', label: 'Default (btree)' },
  { value: 'btree', label: 'btree' },
  { value: 'hash', label: 'hash' },
  { value: 'gin', label: 'gin' },
  { value: 'gist', label: 'gist' },
  { value: 'brin', label: 'brin' },
]

let indexId = 0
export const newIndex = (over: Partial<IndexModel> = {}): IndexModel => ({
  id: `x${++indexId}`,
  name: '',
  columns: [],
  unique: false,
  method: '',
  where: '',
  ...over,
})

// The name we write when the field is left blank — the convention most schemas
// already use, so a hand-made index and a generated one look alike.
export const autoIndexName = (table: string, idx: Pick<IndexModel, 'columns' | 'unique'>) => {
  const slug = [table, ...idx.columns].join('_').replace(/[^A-Za-z0-9_]+/g, '_').replace(/_+/g, '_')
  return `${idx.unique ? 'uq' : 'idx'}_${slug}`.slice(0, 63)
}

export const indexName = (table: string, idx: IndexModel) => (idx.name || '').trim() || autoIndexName(table, idx)

/** The CREATE INDEX for one model, or null when it names no columns yet. */
export function indexCreateSql(table: string, idx: IndexModel, dialect: SqlDialect): string | null {
  const cols = idx.columns.filter(Boolean)
  if (!table || !cols.length) return null
  const q = (name: string) => quoteIdent(name, dialect)
  let sql = `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX ${q(indexName(table, idx))} ON ${q(table)}`
  // USING is Postgres-only syntax — SQLite rejects it outright.
  if (dialect === 'postgresql' && idx.method) sql += ` USING ${idx.method}`
  sql += ` (${cols.map(q).join(', ')})`
  const where = (idx.where || '').trim()
  if (where) sql += ` WHERE ${where}`
  return `${sql};`
}

// In MySQL an index belongs to its table, so the DROP has to name that too.
export const indexDropSql = (name: string, table: string, dialect: SqlDialect) =>
  `DROP INDEX ${quoteIdent(name, dialect)}${dialect === 'mysql' ? ` ON ${quoteIdent(table, dialect)}` : ''};`

/**
 * A live index as an editable model. `(partial)` is SQLite's stand-in for a
 * predicate it couldn't read — it isn't SQL, so it never reaches a statement;
 * `canEdit` below is what refuses to rewrite such an index.
 */
export const liveToIndex = (row: LiveIndex): IndexModel =>
  newIndex({
    name: row.name,
    columns: (row.columns || '').split(',').map((c) => c.trim()).filter(Boolean),
    unique: !!row.unique,
    method: (row.algorithm || '').toLowerCase() === 'btree' ? '' : (row.algorithm || '').toLowerCase(),
    where: row.condition === '(partial)' ? '' : row.condition || '',
  })

/** Everything that decides whether two models would write the same index. */
export const indexSignature = (table: string, idx: IndexModel, dialect: SqlDialect) =>
  JSON.stringify([indexName(table, idx), idx.columns, !!idx.unique, dialect === 'postgresql' ? idx.method : '', (idx.where || '').trim()])

/**
 * Whether this editor may rewrite the index.
 *
 * A constraint's index belongs to the constraint (Postgres refuses DROP INDEX
 * on it; SQLite has no statement for it at all), and an index whose predicate
 * the driver couldn't read would be recreated without it — silently turning a
 * partial index into a full one. Both are shown, neither is edited.
 */
export const canEditIndex = (row: LiveIndex) => !row.primary && !row.constraint && !row.locked && row.condition !== '(partial)'

/** Why an index is read-only, for the badge next to it. */
export const lockedReason = (row: LiveIndex) =>
  row.primary ? 'primary key' : row.constraint ? 'constraint' : row.locked || 'partial'

const CREATE_INDEX_RE =
  /^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF NOT EXISTS\s+)?["`]([^"`]+)["`]\s+ON\s+["`]([^"`]+)["`]\s*(?:USING\s+(\w+)\s*)?\(([^)]*)\)(?:\s*WHERE\s+([\s\S]+?))?\s*;?\s*$/i

/** Inverse of `indexCreateSql`, so a staged CREATE INDEX can be reopened in the form. */
export function parseCreateIndex(sql: string): (IndexModel & { table: string }) | null {
  const m = (sql || '').match(CREATE_INDEX_RE)
  if (!m) return null
  return {
    ...newIndex({
      name: m[2],
      unique: !!m[1],
      method: (m[4] || '').toLowerCase(),
      columns: m[5].split(',').map(unquoteIdent).filter(Boolean),
      where: (m[6] || '').trim(),
    }),
    table: m[3],
  }
}

/** The index name a CREATE INDEX / DROP INDEX statement is about, for rollback. */
export function indexNameIn(sql: string): string | null {
  const created = (sql || '').match(CREATE_INDEX_RE)
  if (created) return created[2]
  const dropped = (sql || '').match(/^\s*DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF EXISTS\s+)?["`]([^"`]+)["`]/i)
  return dropped ? dropped[1] : null
}

/** Rebuild the CREATE INDEX for an index the database currently has — the undo of a drop. */
export const liveIndexSql = (table: string, row: LiveIndex, dialect: SqlDialect) =>
  canEditIndex(row) ? indexCreateSql(table, liveToIndex(row), dialect) : null
