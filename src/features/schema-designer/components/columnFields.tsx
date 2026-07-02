import Checkbox from '@/shared/ui/Checkbox'
import Select from '@/shared/ui/Select'
import Tooltip from '@/shared/ui/Tooltip'
import { TrashIcon } from '@/shared/ui/icons'
import { fieldInput } from '@/shared/lib/styles'

// Base column types per dialect. VARCHAR is kept length-less here so the form
// can offer a custom length (defaulting to 255) instead of hard-coding it.
export const TYPES = {
  sqlite: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'],
  postgresql: ['SERIAL', 'INTEGER', 'BIGINT', 'TEXT', 'VARCHAR', 'BOOLEAN', 'TIMESTAMP', 'DATE', 'NUMERIC'],
}

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
  default: '',
  existing: false,
})

const isVarchar = (type) => (type || '').toUpperCase() === 'VARCHAR'

// Resolve the SQL type string, applying the custom VARCHAR length.
export const columnTypeSql = (c) => (isVarchar(c.type) ? `VARCHAR(${(c.varcharLen || '255').toString().trim() || '255'})` : c.type)

// Full column definition for CREATE TABLE / ALTER TABLE ADD COLUMN.
export const colDef = (c) => {
  let d = `"${c.name.trim()}" ${columnTypeSql(c)}`
  if (c.pk) d += ' PRIMARY KEY'
  if (c.notNull && !c.pk) d += ' NOT NULL'
  if ((c.default ?? '').toString().trim()) d += ` DEFAULT ${c.default.toString().trim()}`
  if (c.fk && c.fkTable && c.fkColumn) d += ` REFERENCES "${c.fkTable}"("${c.fkColumn}")`
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
          className={`${fieldInput} !w-auto min-w-[120px] flex-1`}
          type="text"
          placeholder="column_name"
          value={col.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        <Select
          className={`${fieldInput} !w-[130px] shrink-0`}
          value={col.type}
          onChange={(v) => set({ type: v })}
          options={types.map((t) => ({ value: t, label: t }))}
        />
        {isVarchar(col.type) && (
          <input
            className={`${fieldInput} !w-[72px] shrink-0`}
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
            <button
              type="button"
              className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] text-ink-dim hover:text-red"
              onClick={onRemove}
            >
              <TrashIcon width={15} height={15} />
            </button>
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
          className={`${fieldInput} !w-auto min-w-0 flex-1`}
          type="text"
          placeholder="e.g. 0, 'active', now()"
          value={col.default}
          onChange={(e) => set({ default: e.target.value })}
        />
      </div>

      {col.fk && (
        <div className="mt-2 flex items-center gap-2 px-0.5">
          <span className="shrink-0 text-[11px] text-ink-faint">References</span>
          <Select
            className={`${fieldInput} !w-auto min-w-[120px] flex-1`}
            value={col.fkTable}
            onChange={(v) => set({ fkTable: v, fkColumn: '' })}
            placeholder="table"
            options={tableNames.map((t) => ({ value: t, label: t }))}
          />
          <Select
            className={`${fieldInput} !w-auto min-w-[120px] flex-1`}
            value={col.fkColumn}
            onChange={(v) => set({ fkColumn: v })}
            placeholder="column"
            options={(schema[col.fkTable] || []).map((c) => ({ value: c, label: c }))}
          />
        </div>
      )}
    </div>
  )
}
