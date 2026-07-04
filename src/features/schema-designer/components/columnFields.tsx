import { useEffect, useState } from 'react'
import Checkbox from '@/shared/ui/form/Checkbox'
import Select from '@/shared/ui/form/Select'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import TextButton from '@/shared/ui/buttons/TextButton'
import { TrashIcon } from '@/shared/ui/icons'
import { controlClass } from '@/shared/ui/form/Input'
import { getTypes } from '@/shared/api/database'

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
  const dialect = conn?.type === 'postgresql' ? 'postgresql' : 'sqlite'
  const [types, setTypes] = useState(TYPES[dialect])
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

// Resolve the SQL type string, applying the custom length to a variable-length
// character type while preserving whichever spelling the user picked.
export const columnTypeSql = (c) =>
  isVarchar(c.type) ? `${c.type}(${(c.varcharLen || '255').toString().trim() || '255'})` : c.type

// Full column definition for CREATE TABLE / ALTER TABLE ADD COLUMN.
export const colDef = (c) => {
  let d = `"${c.name.trim()}" ${columnTypeSql(c)}`
  if (c.pk) d += ' PRIMARY KEY'
  if (c.notNull && !c.pk) d += ' NOT NULL'
  if ((c.default ?? '').toString().trim()) d += ` DEFAULT ${c.default.toString().trim()}`
  if (c.fk && c.fkTable && c.fkColumn) {
    d += ` REFERENCES "${c.fkTable}"("${c.fkColumn}")`
    if (c.fkOnDelete) d += ` ON DELETE ${c.fkOnDelete}`
    if (c.fkOnUpdate) d += ` ON UPDATE ${c.fkOnUpdate}`
  }
  return d
}

// One editable column "card" — name, type (+ custom VARCHAR length), primary
// key, not null, default value and foreign key reference. Shared between the
// create-table and edit-table forms so both expose the exact same fields.
export function ColumnField({ col, types, tableNames = [], schema = {}, allowPk = true, onChange, onRemove }) {
  const set = (patch) => onChange(patch)
  return (
    <div className="rounded-soft border border-edge bg-elevated/40 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${controlClass} !w-auto min-w-[120px] flex-1`}
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
          <input
            className={`${controlClass} !w-[72px] shrink-0`}
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
        <input
          className={`${controlClass} !w-auto min-w-0 flex-1`}
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
