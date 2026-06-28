import { useEffect, useMemo, useState } from 'react'
import { getColumns, getSchema } from '../../db/sqlite.js'
import Button from '../ui/Button.jsx'
import Checkbox from '../ui/Checkbox.jsx'
import Select from '../ui/Select.jsx'
import Tooltip from '../ui/Tooltip.jsx'
import { useSlideOver } from '../ui/useSlideOver.js'
import { ChevronRight, PlusIcon, TrashIcon } from '../icons.jsx'
import { fieldInput, fieldLabel } from '../../ui.js'

const TYPES = {
  sqlite: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'],
  postgresql: ['SERIAL', 'INTEGER', 'BIGINT', 'TEXT', 'VARCHAR(255)', 'BOOLEAN', 'TIMESTAMP', 'DATE', 'NUMERIC'],
}

let colId = 0
const newColumn = (type) => ({
  id: `c${++colId}`,
  name: '',
  type,
  pk: false,
  notNull: false,
  fk: false,
  fkTable: '',
  fkColumn: '',
  existing: false,
})

const colDef = (c) => {
  let d = `"${c.name.trim()}" ${c.type}`
  if (c.pk) d += ' PRIMARY KEY'
  if (c.notNull && !c.pk) d += ' NOT NULL'
  if (c.fk && c.fkTable && c.fkColumn) d += ` REFERENCES "${c.fkTable}"("${c.fkColumn}")`
  return d
}

export default function CreateTablePanel({ conn, initialTable, onClose, onStage }) {
  const dialect = conn.type === 'postgresql' ? 'postgresql' : 'sqlite'
  const types = TYPES[dialect]
  const defaultType = dialect === 'postgresql' ? 'SERIAL' : 'INTEGER'
  const isEdit = !!initialTable

  const { show, close } = useSlideOver(onClose)
  const [name, setName] = useState(initialTable || '')
  const [columns, setColumns] = useState(() =>
    isEdit ? [] : [{ ...newColumn(defaultType), name: 'id', pk: true }]
  )
  const [schema, setSchema] = useState({})

  useEffect(() => {
    let alive = true
    getSchema(conn).then((s) => alive && setSchema(s || {}))
    if (isEdit) {
      getColumns(conn, initialTable).then((cols) => {
        if (!alive) return
        setColumns(
          (cols || []).map((c) => ({
            ...newColumn(c.type || 'TEXT'),
            name: c.name,
            type: (c.type || '').toUpperCase() || 'TEXT',
            pk: !!c.pk,
            notNull: !!c.notnull,
            existing: true,
          }))
        )
      })
    }
    return () => {
      alive = false
    }
  }, [conn, initialTable, isEdit])

  const tableNames = Object.keys(schema)
  const newColumns = columns.filter((c) => !c.existing)

  const setCol = (id, patch) => setColumns((cols) => cols.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const addCol = () => setColumns((cols) => [...cols, newColumn(types[0])])
  const removeCol = (id) => setColumns((cols) => cols.filter((c) => c.id !== id))

  // CREATE builds one statement; ALTER builds one ADD COLUMN per new column.
  const statements = useMemo(() => {
    if (isEdit) {
      return newColumns
        .filter((c) => c.name.trim())
        .map((c) => `ALTER TABLE "${initialTable}" ADD COLUMN ${colDef(c)};`)
    }
    const named = columns.filter((c) => c.name.trim())
    if (!name.trim() || named.length === 0) return []
    return [`CREATE TABLE "${name.trim()}" (\n  ${named.map(colDef).join(',\n  ')}\n);`]
  }, [columns, newColumns, name, isEdit, initialTable])

  const valid = isEdit ? statements.length > 0 : name.trim() && statements.length > 0

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!valid) return
    close(() => onStage(statements, name.trim(), isEdit ? 'edit' : 'new'))
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end bg-black/50 transition-opacity duration-200 ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseDown={() => close()}
    >
      <div
        className={`flex h-full w-full max-w-[520px] flex-col border-l border-edge-strong bg-panel shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.8)] transition-transform duration-200 ease-out ${
          show ? 'translate-x-0' : 'translate-x-full'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-edge px-5 py-4">
            <h3 className="text-sm font-bold">{isEdit ? 'Edit Table' : 'Create Table'}</h3>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-soft text-ink-dim hover:bg-elevated hover:text-ink"
              onClick={() => close()}
              aria-label="Close"
            >
              <ChevronRight />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-[18px]">
              <label className={fieldLabel}>Table Name</label>
              <input
                className={fieldInput}
                type="text"
                placeholder="e.g. users"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isEdit}
                autoFocus={!isEdit}
                required
              />
            </div>

            <label className={fieldLabel}>Columns</label>
            <div className="flex flex-col gap-3">
              {columns.map((col) =>
                col.existing ? (
                  <div
                    key={col.id}
                    className="flex items-center gap-2 rounded-soft border border-edge bg-elevated/30 px-3 py-2 text-[11px]"
                  >
                    <span className="flex-1 truncate font-medium text-ink-dim">{col.name}</span>
                    <span className="font-mono text-ink-faint">{col.type}</span>
                    {col.pk && (
                      <span className="rounded bg-green/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-green-bright">PK</span>
                    )}
                    <span className="rounded bg-edge px-1.5 py-0.5 text-[9px] text-ink-faint">existing</span>
                  </div>
                ) : (
                  <div key={col.id} className="rounded-soft border border-edge bg-elevated/40 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        className={`${fieldInput} !w-auto min-w-[120px] flex-1`}
                        type="text"
                        placeholder="column_name"
                        value={col.name}
                        onChange={(e) => setCol(col.id, { name: e.target.value })}
                      />
                      <Select
                        className={`${fieldInput} !w-[130px] shrink-0`}
                        value={col.type}
                        onChange={(v) => setCol(col.id, { type: v })}
                        options={types.map((t) => ({ value: t, label: t }))}
                      />
                      <Tooltip label="Remove column" placement="top">
                        <button
                          type="button"
                          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] text-ink-dim hover:text-red"
                          onClick={() => removeCol(col.id)}
                        >
                          <TrashIcon width={15} height={15} />
                        </button>
                      </Tooltip>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-0.5">
                      {!isEdit && (
                        <div className="flex items-center gap-1.5 text-[11px] text-ink-dim">
                          <Checkbox checked={col.pk} onChange={(v) => setCol(col.id, { pk: v })} ariaLabel="Primary key" />
                          Primary key
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 text-[11px] text-ink-dim">
                        <Checkbox checked={col.notNull} onChange={(v) => setCol(col.id, { notNull: v })} ariaLabel="Not null" />
                        Not null
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-ink-dim">
                        <Checkbox
                          checked={col.fk}
                          disabled={tableNames.length === 0}
                          onChange={(v) => setCol(col.id, { fk: v })}
                          ariaLabel="Foreign key"
                        />
                        Foreign key
                      </div>
                    </div>

                    {col.fk && (
                      <div className="mt-2 flex items-center gap-2 px-0.5">
                        <span className="text-[11px] text-ink-faint">References</span>
                        <Select
                          className={`${fieldInput} !w-auto min-w-[120px] flex-1`}
                          value={col.fkTable}
                          onChange={(v) => setCol(col.id, { fkTable: v, fkColumn: '' })}
                          placeholder="table"
                          options={tableNames.map((t) => ({ value: t, label: t }))}
                        />
                        <Select
                          className={`${fieldInput} !w-auto min-w-[120px] flex-1`}
                          value={col.fkColumn}
                          onChange={(v) => setCol(col.id, { fkColumn: v })}
                          placeholder="column"
                          options={(schema[col.fkTable] || []).map((c) => ({ value: c, label: c }))}
                        />
                      </div>
                    )}
                  </div>
                )
              )}
            </div>

            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-green hover:text-green-bright"
              onClick={addCol}
            >
              <PlusIcon width={14} height={14} /> Add column
            </button>

            {isEdit && (
              <p className="mt-3 text-[11px] text-ink-faint">
                Editing supports adding new columns (existing columns can’t be altered here).
              </p>
            )}

            {statements.length > 0 && (
              <pre className="mt-5 overflow-x-auto rounded-soft border border-edge bg-bg px-3.5 py-3 font-mono text-[11px] leading-[1.6] text-ink-dim">
                {statements.join('\n')}
              </pre>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-3 border-t border-edge px-5 py-4">
            <Button type="button" variant="subtle" onClick={() => close()}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!valid}>
              Add to changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
