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
  const columns = await getColumns(conn, table)
  const col = columns?.find((c: any) => c.name === match[1])
  if (!col) return null
  return `ALTER TABLE "${table}" ADD COLUMN ${columnDef(col)};`
}

// One column's definition string (same shape as getColumns()'s response),
// mirroring columnFields.tsx's colDef() quoting. Shared by CREATE TABLE and
// ADD COLUMN reconstruction.
export function columnDef(c: any) {
  let d = `"${c.name}" ${c.type || 'TEXT'}`
  if (c.pk) d += ' PRIMARY KEY'
  if (c.notnull && !c.pk) d += ' NOT NULL'
  if (c.default != null && String(c.default).trim()) d += ` DEFAULT ${c.default}`
  if (c.references?.table && c.references?.column) {
    d += ` REFERENCES "${c.references.table}"("${c.references.column}")`
  }
  return d
}

// Reconstruct a CREATE TABLE statement from a live column list.
export function buildCreateTableSql(table: string, columns: any[]) {
  return `CREATE TABLE "${table}" (\n  ${columns.map(columnDef).join(',\n  ')}\n);`
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
  const rollbacks = await Promise.all(
    items.map(async (i: any) => {
      if (i.mode === 'delete') return (await buildDropTableRollback(conn, i.table)).rollbackSql
      if (i.mode === 'new') return rollbackForCreateTable(i.table)
      // edit — an ALTER TABLE that either adds or drops a column.
      if (/DROP COLUMN/i.test(i.sql)) return rollbackForDropColumn(conn, i.sql, i.table)
      return rollbackForAddColumn(i.sql, i.table)
    }),
  )
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
  const columns = await getColumns(conn, table)
  if (!columns?.length) return { rollbackSql: null, reversible: false }
  return { rollbackSql: buildCreateTableSql(table, columns), reversible: true }
}
