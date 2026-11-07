import { useEffect, useState } from 'react'
import Checkbox from '@/shared/ui/form/Checkbox'
import Select from '@/shared/ui/form/Select'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import TextButton from '@/shared/ui/buttons/TextButton'
import { TrashIcon } from '@/shared/ui/icons'
import { controlClass, Input } from '@/shared/ui/form/Input'
import { getTypes } from '@/shared/api/database'
import { IDENT, quoteIdent, sqlDialectOf, unquoteIdent, type SqlDialect } from '@/shared/lib/sqlDialect'
import { fkAddSql, fkReferenceSql } from '../lib/ddl'

// Fallback type lists per dialect, used until the backend `/types` list loads.
// Postgres uses the database's own vocabulary so existing and new columns share
// one option set; a variable-length type (character varying) gets a length input.
export const TYPES = {
  sqlite: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'],
  postgresql: [
    'serial', 'bigserial', 'smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision',
    'boolean', 'text', 'character varying', 'character', 'date', 'time without time zone',
    'timestamp without time zone', 'timestamp with time zone', 'json', 'jsonb', 'uuid',
  ],
  mysql: [
    'int auto_increment', 'bigint auto_increment', 'tinyint', 'smallint', 'int', 'bigint', 'decimal(10,2)', 'float', 'double',
    'boolean', 'char', 'varchar', 'text', 'mediumtext', 'longtext', 'date', 'time', 'datetime', 'timestamp', 'json', 'blob',
  ],
}

// Referential actions for a foreign key's ON DELETE / ON UPDATE clause. Empty
// value means "unspecified" (the SQL default of NO ACTION), so it's omitted.
export const FK_ACTIONS = [
  { value: '', label: 'No action' },
  { value: 'CASCADE', label: 'Cascade' },
  { value: 'SET NULL', label: 'Set null' },
  { value: 'SET DEFAULT', label: 'Set default' },
  { value: 'RESTRICT', label: 'Restrict' },
]

let colId = 0
// A single, shared column model used by both the create and edit forms so the
// two stay in lock-step. `varcharLen` only applies when type === 'VARCHAR'.
export const newColumn = (type) => ({
  id: `c${++colId}`,
  name: '',
  type,
  varcharLen: '255',
  pk: false,
  notNull: false,
  fk: false,
  fkTable: '',
  fkColumn: '',
  fkOnDelete: '',
  fkOnUpdate: '',
  default: '',
  existing: false,
})

// Column types for a connection, fetched from the backend with the static
// per-dialect list as an immediate fallback while the request is in flight.
export function useColumnTypes(conn) {
  const [types, setTypes] = useState(TYPES[sqlDialectOf(conn?.type)])
  useEffect(() => {
    let alive = true
    getTypes(conn).then((list) => {
      if (alive && Array.isArray(list) && list.length) setTypes(list)
    })
    return () => {
      alive = false
    }
  }, [conn])
  return types
}

// Variable-length character types get a length input (VARCHAR or the Postgres
// spelling "character varying").
const isVarchar = (type) => /^(varchar|character varying)$/i.test((type || '').trim())

// Collapse a SQL type to a comparable base family: strip length/precision
// parens, fold serial types to their integer equivalent, and lowercase.
// Used to decide whether two columns are FK-compatible in the diagram's
// drag-to-connect mode.
export function normalizeFkType(type) {
  // Drop length/precision parens, a trailing statement `;`, and any inline
  // column modifiers (NOT NULL, DEFAULT …) that can ride along when the type
  // comes from a staged ADD COLUMN statement rather than the live schema.
  const t = (type || '')
    .toLowerCase()
    .replace(/\(.*\)/, '')
    .replace(/\s+(not\s+null|primary\s+key|default|references|auto_increment)\b.*$/, '')
    .replace(/;.*$/, '')
    .trim()
  const map = {
    serial: 'integer', bigserial: 'bigint', smallserial: 'smallint',
    int: 'integer', int4: 'integer', int8: 'bigint', int2: 'smallint',
    varchar: 'character varying', 'character varying': 'character varying',
  }
  return map[t] || t
}

// Treat the SQL default (NO ACTION) as "unspecified" so a FK's ON DELETE / ON
// UPDATE round-trips cleanly through an empty-string form field.
export const normFkAction = (a) => (a && a !== 'NO ACTION' ? a : '')

// Whether a foreign key can be drawn from `srcCol` to `tgtCol`: the target
// must be a primary key (the only uniqueness the diagram exposes) and the two
// columns' base types must match, and it can't be to the same column.
export function fkEligible(srcTable, srcCol, tgtTable, tgtCol) {
  if (!srcCol || !tgtCol) return false
  if (srcTable === tgtTable && srcCol.name === tgtCol.name) return false
  if (!tgtCol.pk) return false
  return normalizeFkType(srcCol.type) === normalizeFkType(tgtCol.type)
}

// Resolve the SQL type string, applying the custom length to a variable-length
// character type while preserving whichever spelling the user picked.
export const columnTypeSql = (c) =>
  isVarchar(c.type) ? `${c.type}(${(c.varcharLen || '255').toString().trim() || '255'})` : c.type

const hasFk = (c) => !!(c.fk && c.fkTable && c.fkColumn)

// Full column definition for CREATE TABLE / ALTER TABLE ADD COLUMN. Pass
// `inlinePk: false` when the primary key is emitted as a table-level constraint
// (a composite key) — the column then carries NOT NULL instead of PRIMARY KEY.
export const colDef = (c, { inlinePk = true, dialect }: { inlinePk?: boolean; dialect: SqlDialect }) => {
  const pkInline = c.pk && inlinePk
  let d = `${quoteIdent(c.name.trim(), dialect)} ${columnTypeSql(c)}`
  if (pkInline) d += ' PRIMARY KEY'
  if (!pkInline && (c.notNull || c.pk)) d += ' NOT NULL'
  if ((c.default ?? '').toString().trim()) d += ` DEFAULT ${c.default.toString().trim()}`
  // MySQL parses a column-level REFERENCES and then ignores it, without a word:
  // the column would exist and the constraint wouldn't. Its foreign keys are
  // written as a table-level line (tableDefLines) or their own ALTER (addColumnSql).
  if (hasFk(c) && dialect !== 'mysql') d += ` ${fkReferenceSql(c.fkTable, c.fkColumn, c.fkOnDelete, c.fkOnUpdate, dialect)}`
  return d
}

// The statements that add one column to an existing table.
export function addColumnSql(table, c, dialect: SqlDialect) {
  const add = `ALTER TABLE ${quoteIdent(table, dialect)} ADD COLUMN ${colDef(c, { dialect })};`
  if (!hasFk(c) || dialect !== 'mysql') return [add]
  const column = c.name.trim()
  const fk = { table, constraint: `${table}_${column}_fkey`, column, refTable: c.fkTable, refColumn: c.fkColumn, onDelete: c.fkOnDelete, onUpdate: c.fkOnUpdate }
  return [add, fkAddSql(fk, dialect)]
}

// The inner lines of a CREATE TABLE: one per column, plus a trailing table-level
// `PRIMARY KEY (...)` when two or more columns are primary keys. A single PK
// stays inline on its column; multiple inline PRIMARY KEYs are invalid SQL.
export const tableDefLines = (columns, dialect: SqlDialect) => {
  const pks = columns.filter((c) => c.pk)
  const composite = pks.length > 1
  const lines = columns.map((c) => colDef(c, { inlinePk: !composite, dialect }))
  if (composite) {
    lines.push(`PRIMARY KEY (${pks.map((c) => quoteIdent(c.name.trim(), dialect)).join(', ')})`)
  }
  if (dialect === 'mysql') {
    for (const c of columns.filter(hasFk)) {
      lines.push(`FOREIGN KEY (${quoteIdent(c.name.trim(), dialect)}) ${fkReferenceSql(c.fkTable, c.fkColumn, c.fkOnDelete, c.fkOnUpdate, dialect)}`)
    }
  }
  return lines
}

// Split a CREATE TABLE body on its top-level commas — commas nested in parens
// (`numeric(10,2)`) or inside a quoted string (`DEFAULT 'a, b'`) or identifier
// belong to the definition they sit in and must not split it.
export function splitTopLevel(body) {
  const parts = []
  let depth = 0
  let quote = null // the open quote character, if we're inside one
  let cur = ''
  for (const ch of body || '') {
    if (quote) {
      // A doubled quote is an escaped one ('' inside a string), so this closes
      // the string only if the next character reopens it — which the next
      // iteration handles by starting a fresh string.
      if (ch === quote) quote = null
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts
}

const FK_ACTION_RE = 'CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION'
const FK_REFERENCE_RE = `REFERENCES\\s+${IDENT}\\s*\\(\\s*${IDENT}\\s*\\)(?:\\s+ON DELETE\\s+(${FK_ACTION_RE}))?(?:\\s+ON UPDATE\\s+(${FK_ACTION_RE}))?`

// Put a parsed REFERENCES clause (groups: table, column, on delete, on update,
// from `at`) onto its column.
function applyFk(col, m, at) {
  col.fk = true
  col.fkTable = m[at]
  col.fkColumn = m[at + 1]
  col.fkOnDelete = normFkAction((m[at + 2] || '').toUpperCase())
  col.fkOnUpdate = normFkAction((m[at + 3] || '').toUpperCase())
}

// Inverse of `colDef`: turn one column definition back into the shared column
// model. Clauses are peeled off right-to-left in the order `colDef` writes
// them; whatever is left over is the type, which may be several words
// (`double precision`) and carry a length (`character varying(255)`).
function parseColumnDef(part) {
  const m = (part || '').trim().match(new RegExp(`^${IDENT}\\s+([\\s\\S]+)$`))
  if (!m) return null
  const col = { ...newColumn('TEXT'), name: m[1] }
  let rest = m[2].trim()

  const fk = rest.match(new RegExp(`\\s*${FK_REFERENCE_RE}\\s*$`, 'i'))
  if (fk) {
    applyFk(col, fk, 1)
    rest = rest.slice(0, fk.index).trim()
  }
  const def = rest.match(/\s*DEFAULT\s+([\s\S]+)$/i)
  if (def) {
    col.default = def[1].trim()
    rest = rest.slice(0, def.index).trim()
  }
  if (/\s+NOT\s+NULL\s*$/i.test(rest)) {
    col.notNull = true
    rest = rest.replace(/\s+NOT\s+NULL\s*$/i, '').trim()
  }
  if (/\s+PRIMARY\s+KEY\s*$/i.test(rest)) {
    col.pk = true
    rest = rest.replace(/\s+PRIMARY\s+KEY\s*$/i, '').trim()
  }

  const len = rest.match(/^([\s\S]*?)\s*\(\s*(\d+)\s*\)\s*$/)
  if (len) {
    col.type = len[1].trim()
    col.varcharLen = len[2]
  } else col.type = rest
  return col
}

// Parse a CREATE TABLE body into editable columns, so a staged (uncommitted)
// CREATE TABLE can be reopened in the create-table form. A table-level
// `PRIMARY KEY (a, b)` (a composite key) and a MySQL `FOREIGN KEY (a) REFERENCES …`
// are applied back onto their columns; other table-level constraints don't match
// a column definition and are dropped.
export const parseColumnDefs = (body) => {
  const parts = splitTopLevel(body)
  const pkNames = new Set()
  for (const part of parts) {
    const m = part.trim().match(/^PRIMARY KEY\s*\(([^)]*)\)\s*$/i)
    if (m) {
      for (const n of m[1].split(',')) {
        const name = unquoteIdent(n)
        if (name) pkNames.add(name)
      }
    }
  }
  const cols = parts.map(parseColumnDef).filter(Boolean)
  if (pkNames.size) for (const c of cols) if (pkNames.has(c.name)) c.pk = true
  const fkLine = new RegExp(`^FOREIGN KEY\\s*\\(\\s*${IDENT}\\s*\\)\\s*${FK_REFERENCE_RE}\\s*$`, 'i')
  for (const part of parts) {
    const m = part.trim().match(fkLine)
    const col = m && cols.find((c) => c.name === m[1])
    if (col) applyFk(col, m, 2)
  }
  return cols
}

// One editable column "card" — name, type (+ custom VARCHAR length), primary
// key, not null, default value and foreign key reference. Shared between the
// create-table and edit-table forms so both expose the exact same fields.
//
// `dragHandle` is the grip a reorderable list passes in (see useDragReorder).
// The card renders it but knows nothing about the gesture: column *order* is
// the list's business, not the field's.
export function ColumnField({ col, types, tableNames = [], schema = {}, allowPk = true, dragHandle = null, onChange, onRemove }) {
  const set = (patch) => onChange(patch)
  return (
    <div className="rounded-soft border border-edge bg-elevated/40 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {dragHandle}
        <Input
          className="!w-auto min-w-[120px] flex-1"
          type="text"
          placeholder="column_name"
          value={col.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        <Select
          className={`${controlClass} !w-[130px] shrink-0`}
          value={col.type}
          onChange={(v) => set({ type: v })}
          options={types.map((t) => ({ value: t, label: t }))}
        />
        {isVarchar(col.type) && (
          <Input
            className="!w-[72px] shrink-0"
            type="number"
            min="1"
            placeholder="255"
            value={col.varcharLen}
            onChange={(e) => set({ varcharLen: e.target.value })}
            aria-label="VARCHAR length"
          />
        )}
        {onRemove && (
          <Tooltip label="Remove column" placement="top">
            <TextButton className="h-[30px] w-[30px] shrink-0 justify-center rounded-[8px] hover:!text-red" onClick={onRemove}>
              <TrashIcon width={15} height={15} />
            </TextButton>
          </Tooltip>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-0.5">
        {allowPk && (
          <div className="flex items-center gap-1.5 text-[11px] text-ink-dim">
            <Checkbox checked={col.pk} onChange={(v) => set({ pk: v })} ariaLabel="Primary key" />
            Primary key
          </div>
        )}
        <div className="flex items-center gap-1.5 text-[11px] text-ink-dim">
          <Checkbox checked={col.notNull} onChange={(v) => set({ notNull: v })} ariaLabel="Not null" />
          Not null
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-ink-dim">
          <Checkbox
            checked={col.fk}
            disabled={tableNames.length === 0}
            onChange={(v) => set({ fk: v })}
            ariaLabel="Foreign key"
          />
          Foreign key
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 px-0.5">
        <span className="shrink-0 text-[11px] text-ink-faint">Default</span>
        <Input
          className="!w-auto min-w-0 flex-1"
          type="text"
          placeholder="e.g. 0, 'active', now()"
          value={col.default}
          onChange={(e) => set({ default: e.target.value })}
        />
      </div>

      {col.fk && (
        <>
          <div className="mt-2 flex items-center gap-2 px-0.5">
            <span className="shrink-0 text-[11px] text-ink-faint">References</span>
            <Select
              className={`${controlClass} !w-auto min-w-[120px] flex-1`}
              value={col.fkTable}
              onChange={(v) => set({ fkTable: v, fkColumn: '' })}
              placeholder="table"
              options={tableNames.map((t) => ({ value: t, label: t }))}
            />
            <Select
              className={`${controlClass} !w-auto min-w-[120px] flex-1`}
              value={col.fkColumn}
              onChange={(v) => set({ fkColumn: v })}
              placeholder="column"
              options={(schema[col.fkTable] || []).map((c) => ({ value: c, label: c }))}
            />
          </div>
          <div className="mt-2 flex items-center gap-2 px-0.5">
            <span className="shrink-0 text-[11px] text-ink-faint">On delete</span>
            <Select
              className={`${controlClass} !w-auto min-w-0 flex-1`}
              value={col.fkOnDelete}
              onChange={(v) => set({ fkOnDelete: v })}
              options={FK_ACTIONS}
            />
            <span className="shrink-0 text-[11px] text-ink-faint">On update</span>
            <Select
              className={`${controlClass} !w-auto min-w-0 flex-1`}
              value={col.fkOnUpdate}
              onChange={(v) => set({ fkOnUpdate: v })}
              options={FK_ACTIONS}
            />
          </div>
        </>
      )}
    </div>
  )
}
