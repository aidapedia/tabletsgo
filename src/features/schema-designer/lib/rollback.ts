import { getColumns } from '@/shared/api/database'

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

// Reconstruct a CREATE TABLE statement from a live column list (same shape as
// getColumns()'s response), mirroring columnFields.tsx's colDef() quoting.
export function buildCreateTableSql(table: string, columns: any[]) {
  const defs = columns.map((c) => {
    let d = `"${c.name}" ${c.type || 'TEXT'}`
    if (c.pk) d += ' PRIMARY KEY'
    if (c.notnull && !c.pk) d += ' NOT NULL'
    if (c.default != null && String(c.default).trim()) d += ` DEFAULT ${c.default}`
    if (c.references?.table && c.references?.column) {
      d += ` REFERENCES "${c.references.table}"("${c.references.column}")`
    }
    return d
  })
  return `CREATE TABLE "${table}" (\n  ${defs.join(',\n  ')}\n);`
}

// Fetch a table's current columns and build its rollback (a CREATE TABLE that
// would restore it) before a DROP TABLE executes. Falls back to "not
// reversible" if the columns can't be read.
export async function buildDropTableRollback(conn, table: string) {
  const columns = await getColumns(conn, table)
  if (!columns?.length) return { rollbackSql: null, reversible: false }
  return { rollbackSql: buildCreateTableSql(table, columns), reversible: true }
}
