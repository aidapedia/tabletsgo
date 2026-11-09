import { quoteIdent, type SqlDialect } from '@/shared/lib/sqlDialect'

// The ALTER statements an engine spells its own way. Pure strings, shared by the
// panels that stage them and by the rollback that writes their inverse.

export type ForeignKey = {
  table: string
  constraint: string
  column: string
  refTable: string
  refColumn: string
  onDelete?: string
  onUpdate?: string
}

const action = (clause: string, value?: string) => (value && value !== 'NO ACTION' ? ` ${clause} ${value}` : '')

/** `REFERENCES t(c) ON DELETE …`, the tail every way of declaring a foreign key ends in. */
export const fkReferenceSql = (refTable: string, refColumn: string, onDelete: string, onUpdate: string, dialect: SqlDialect) =>
  `REFERENCES ${quoteIdent(refTable, dialect)}(${quoteIdent(refColumn, dialect)})${action('ON DELETE', onDelete)}${action('ON UPDATE', onUpdate)}`

export function fkAddSql(fk: ForeignKey, dialect: SqlDialect) {
  const q = (name: string) => quoteIdent(name, dialect)
  const reference = fkReferenceSql(fk.refTable, fk.refColumn, fk.onDelete || '', fk.onUpdate || '', dialect)
  return `ALTER TABLE ${q(fk.table)} ADD CONSTRAINT ${q(fk.constraint)} FOREIGN KEY (${q(fk.column)}) ${reference};`
}

// MySQL only learned DROP CONSTRAINT in 8.0.19; DROP FOREIGN KEY works on all of them.
export const fkDropSql = (table: string, constraint: string, dialect: SqlDialect) =>
  `ALTER TABLE ${quoteIdent(table, dialect)} ${dialect === 'mysql' ? 'DROP FOREIGN KEY' : 'DROP CONSTRAINT'} ${quoteIdent(constraint, dialect)};`

type ColumnSpec = { name: string; type: string; notnull?: boolean; default?: string | null; extra?: string }

/**
 * MySQL's way to change a column: MODIFY replaces its whole definition, so one
 * statement restates all of it — anything left out (`extra` carries AUTO_INCREMENT,
 * ON UPDATE and the comment) would be dropped rather than kept.
 */
export function modifyColumnSql(table: string, c: ColumnSpec, dialect: SqlDialect) {
  const fallback = (c.default ?? '').toString().trim()
  const parts = [c.type, c.notnull ? 'NOT NULL' : 'NULL', fallback && `DEFAULT ${fallback}`, c.extra].filter(Boolean)
  return `ALTER TABLE ${quoteIdent(table, dialect)} MODIFY COLUMN ${quoteIdent(c.name, dialect)} ${parts.join(' ')};`
}
