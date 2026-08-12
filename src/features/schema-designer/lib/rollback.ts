import { getColumns } from '@/shared/api/database'
import { draftToItems } from '@/shared/lib/schemaDraft'

// Best-effort rollback SQL for the DDL this feature can stage: CREATE TABLE,
// ALTER TABLE ADD COLUMN, and DROP TABLE. Row-level data changes (INSERT/
// UPDATE/DELETE) and DELETE FROM (empty table) never go through here — the
// former isn't schema DDL, the latter isn't reconstructable without a data
// snapshot, so it's marked non-reversible instead.

export const rollbackForCreateTable = (table: string) => `DROP TABLE "${table}";`

// colDef() (columnFields.tsx) always quotes the column name in
// `ADD COLUMN "name" ...`, so a straight regex extraction is reliable.
export function rollbackForAddColumn(sql: string, table: string) {
  const match = sql.match(/ADD COLUMN\s+"([^"]+)"/i)
  if (!match) return null
  return `ALTER TABLE "${table}" DROP COLUMN "${match[1]}";`
}

// A DROP COLUMN's inverse is an ADD COLUMN that re-adds it with its original
// definition — which we can only recover from the *live* schema, so this reads
// the column list before the drop runs. Returns null if the column can't be
// found (already gone / table missing), so the caller marks it non-reversible.
export async function rollbackForDropColumn(conn: any, sql: string, table: string) {
  const match = sql.match(/DROP COLUMN\s+"([^"]+)"/i)
  if (!match) return null
  const col = await liveColumn(conn, table, match[1])
  if (!col) return null
  return `ALTER TABLE "${table}" ADD COLUMN ${columnDef(col)};`
}

// One column as the database currently has it — the only source for the
// "before" side of a statement that overwrites a definition (a drop, a type
// change, a default change). Reads nothing when there is no connection behind
// the editor (a from-scratch design), so the caller marks it non-reversible.
async function liveColumn(conn: any, table: string, name: string) {
  if (!conn?.id) return null
  const columns = await getColumns(conn, table)
  return columns?.find((c: any) => c.name === name) || null
}

// The inverse of one ALTER TABLE the editor stages. Renames, NOT NULL flips and
// constraint adds invert syntactically; a dropped column, a changed type and a
// changed default need the live definition, so this only builds them *before*
// the statement runs. Everything else (notably DROP CONSTRAINT, whose original
// definition is gone once it executes) has no automatic inverse — the FK editor
// stages its own `rollbackSql` for that case, which takes priority over this.
export async function rollbackForAlter(conn: any, sql: string, table: string) {
  const rename = sql.match(/RENAME COLUMN\s+"([^"]+)"\s+TO\s+"([^"]+)"/i)
  if (rename) return `ALTER TABLE "${table}" RENAME COLUMN "${rename[2]}" TO "${rename[1]}";`
  const addConstraint = sql.match(/ADD CONSTRAINT\s+"([^"]+)"/i)
  if (addConstraint) return `ALTER TABLE "${table}" DROP CONSTRAINT "${addConstraint[1]}";`
  const notNull = sql.match(/ALTER COLUMN\s+"([^"]+)"\s+(SET|DROP)\s+NOT NULL/i)
  if (notNull) {
    return `ALTER TABLE "${table}" ALTER COLUMN "${notNull[1]}" ${/set/i.test(notNull[2]) ? 'DROP' : 'SET'} NOT NULL;`
  }
  if (/DROP COLUMN/i.test(sql)) return rollbackForDropColumn(conn, sql, table)
  if (/ADD COLUMN/i.test(sql)) return rollbackForAddColumn(sql, table)
  const typeChange = sql.match(/ALTER COLUMN\s+"([^"]+)"\s+TYPE\b/i)
  if (typeChange) {
    const col = await liveColumn(conn, table, typeChange[1])
    return col?.type ? `ALTER TABLE "${table}" ALTER COLUMN "${col.name}" TYPE ${col.type};` : null
  }
  const defaultChange = sql.match(/ALTER COLUMN\s+"([^"]+)"\s+(?:SET|DROP)\s+DEFAULT/i)
  if (defaultChange) {
    const col = await liveColumn(conn, table, defaultChange[1])
    if (!col) return null
    const had = col.default != null && String(col.default).trim()
    return had
      ? `ALTER TABLE "${table}" ALTER COLUMN "${col.name}" SET DEFAULT ${col.default};`
      : `ALTER TABLE "${table}" ALTER COLUMN "${col.name}" DROP DEFAULT;`
  }
  return null
}

// The down SQL for one staged item, whichever panel staged it. An item that
// already carries its own `rollbackSql` (the FK editor builds a matched pair)
// keeps it; everything else is derived from the statement itself. Best-effort
// by design: anything this can't reverse returns null and the migration records
// itself as non-reversible rather than as a rollback that would fail.
//
// Reading the live schema can fail (a table someone else just dropped); that is
// a statement without a down SQL, not a failed release, so it resolves to null.
export async function rollbackForItem(conn: any, item: any): Promise<string | null> {
  if (item?.rollbackSql) return item.rollbackSql
  const sql = (item?.sql || '').trim()
  const table = item?.table
  if (!sql || !table) return null
  try {
    if (/^CREATE TABLE/i.test(sql)) return rollbackForCreateTable(table)
    if (/^DROP TABLE/i.test(sql)) return (await buildDropTableRollback(conn, table)).rollbackSql
    if (/^ALTER TABLE/i.test(sql)) return await rollbackForAlter(conn, sql, table)
    return null
  } catch {
    return null
  }
}

// Pair every staged item with the down SQL that would undo it. Run this before
// the statements execute — the ones reconstructed from the live schema (DROP
// TABLE, DROP COLUMN, a type or default change) can only be read while the old
// definition is still there.
export async function resolveRollbacks(conn: any, items: any[]) {
  return Promise.all(items.map(async (i) => ({ ...i, rollbackSql: await rollbackForItem(conn, i) })))
}

// One column's definition string (same shape as getColumns()'s response),
// mirroring columnFields.tsx's colDef() quoting. Shared by CREATE TABLE and
// ADD COLUMN reconstruction.
export function columnDef(c: any, inlinePk = true) {
  const pkInline = c.pk && inlinePk
  let d = `"${c.name}" ${c.type || 'TEXT'}`
  if (pkInline) d += ' PRIMARY KEY'
  if (!pkInline && (c.notnull || c.pk)) d += ' NOT NULL'
  if (c.default != null && String(c.default).trim()) d += ` DEFAULT ${c.default}`
  if (c.references?.table && c.references?.column) {
    d += ` REFERENCES "${c.references.table}"("${c.references.column}")`
  }
  return d
}

// Reconstruct a CREATE TABLE statement from a live column list. Two or more
// primary-key columns become one table-level `PRIMARY KEY (...)` constraint —
// multiple inline PRIMARY KEYs are invalid SQL.
export function buildCreateTableSql(table: string, columns: any[]) {
  const pks = columns.filter((c) => c.pk)
  const composite = pks.length > 1
  const lines = columns.map((c) => columnDef(c, !composite))
  if (composite) {
    lines.push(`PRIMARY KEY (${pks.map((c) => `"${c.name}"`).join(', ')})`)
  }
  return `CREATE TABLE "${table}" (\n  ${lines.join(',\n  ')}\n);`
}

// Best-effort forward (Up) / rollback (Down) SQL for a saved schema draft, for
// the draft inspector. Reuses the same per-statement builders the commit path
// uses (CREATE TABLE ↔ DROP TABLE, ADD COLUMN ↔ DROP COLUMN). A DROP TABLE /
// DROP COLUMN's down SQL is reconstructed from the *live* schema, so this is
// async and takes the connection, mirroring the commit path.
//
// Unlike a committed migration (all-or-nothing), the draft inspector is a
// read-only preview, so it always shows what down SQL it can: statements it
// can't reverse get an inline `-- No automatic down SQL` note instead of
// blanking the whole panel. `reversible` still reports whether *every*
// statement was reversible. Down SQL runs in reverse order so the last change
// is undone first.
export async function buildDraftMigration(conn: any, sql: string) {
  const items = draftToItems(sql)
  const forwardSql = items.map((i) => i.sql)
  const rollbacks = await Promise.all(items.map((i: any) => rollbackForItem(conn, i)))
  const reversible = rollbacks.length > 0 && rollbacks.every(Boolean)
  const rollbackSql = items
    .map((i: any, idx: number) => rollbacks[idx] || `-- No automatic down SQL for: ${i.sql}`)
    .reverse()
  return { forwardSql, rollbackSql, reversible }
}

// Fetch a table's current columns and build its rollback (a CREATE TABLE that
// would restore it) before a DROP TABLE executes. Falls back to "not
// reversible" if the columns can't be read.
export async function buildDropTableRollback(conn, table: string) {
  const columns = conn?.id ? await getColumns(conn, table) : null
  if (!columns?.length) return { rollbackSql: null, reversible: false }
  return { rollbackSql: buildCreateTableSql(table, columns), reversible: true }
}
