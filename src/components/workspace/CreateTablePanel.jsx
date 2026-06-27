import { useEffect, useMemo, useState } from 'react'
import { getSchema } from '../../db/sqlite.js'
import Button from '../ui/Button.jsx'
import Select from '../ui/Select.jsx'
import Tooltip from '../ui/Tooltip.jsx'
import { useSlideOver } from '../ui/useSlideOver.js'
import { ChevronRight, PlusIcon, TrashIcon } from '../icons.jsx'
import { fieldInput, fieldLabel } from '../../ui.js'

const TYPES = {
  sqlite: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'],
  postgresql: ['SERIAL', 'INTEGER', 'BIGINT', 'TEXT', 'VARCHAR(255)', 'BOOLEAN', 'TIMESTAMP', 'DATE', 'NUMERIC'],
}

const newColumn = (type) => ({ name: '', type, pk: false, notNull: false, fk: false, fkTable: '', fkColumn: '' })

function buildSql(name, columns) {
  const cols = columns.filter((c) => c.name.trim())
  const defs = cols.map((c) => {
    let d = `"${c.name.trim()}" ${c.type}`
    if (c.pk) d += ' PRIMARY KEY'
    if (c.notNull && !c.pk) d += ' NOT NULL'
    if (c.fk && c.fkTable && c.fkColumn) d += ` REFERENCES "${c.fkTable}"("${c.fkColumn}")`
    return d
  })
  return `CREATE TABLE "${name.trim()}" (\n  ${defs.join(',\n  ')}\n);`
}

export default function CreateTablePanel({ conn, onClose, onStage }) {
  const dialect = conn.type === 'postgresql' ? 'postgresql' : 'sqlite'
  const types = TYPES[dialect]
  const defaultType = dialect === 'postgresql' ? 'SERIAL' : 'INTEGER'

  const { show, close } = useSlideOver(onClose)
  const [name, setName] = useState('')
  const [columns, setColumns] = useState(() => [{ ...newColumn(defaultType), name: 'id', pk: true }])
  const [schema, setSchema] = useState({})

  useEffect(() => {
    let alive = true
    getSchema(conn).then((s) => alive && setSchema(s || {}))
    return () => {
      alive = false
    }
  }, [conn])

  const tableNames = Object.keys(schema)

  const setCol = (i, patch) => setColumns((cols) => cols.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  const addCol = () => setColumns((cols) => [...cols, newColumn(types[0])])
  const removeCol = (i) => setColumns((cols) => cols.filter((_, idx) => idx !== i))

  const valid = name.trim() && columns.some((c) => c.name.trim())
  const sql = useMemo(() => (valid ? buildSql(name, columns) : ''), [name, columns, valid])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!valid) return
    close(() => onStage(sql, name.trim()))
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
            <h3 className="text-sm font-bold">Create Table</h3>
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
                autoFocus
                required
              />
            </div>

            <label className={fieldLabel}>Columns</label>
            <div className="flex flex-col gap-3">
              {columns.map((col, i) => (
                <div key={i} className="rounded-soft border border-edge bg-elevated/40 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className={`${fieldInput} !w-auto min-w-[120px] flex-1`}
                      type="text"
                      placeholder="column_name"
                      value={col.name}
                      onChange={(e) => setCol(i, { name: e.target.value })}
                    />
                    <Select
                      className={`${fieldInput} !w-[130px] shrink-0`}
                      value={col.type}
                      onChange={(v) => setCol(i, { type: v })}
                      options={types.map((t) => ({ value: t, label: t }))}
                    />
                    <Tooltip label="Remove column" placement="top">
                      <button
                        type="button"
                        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] text-ink-dim hover:text-red disabled:opacity-30 disabled:hover:text-ink-dim"
                        onClick={() => removeCol(i)}
                        disabled={columns.length === 1}
                      >
                        <TrashIcon width={15} height={15} />
                      </button>
                    </Tooltip>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-0.5">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-dim">
                      <input type="checkbox" checked={col.pk} onChange={(e) => setCol(i, { pk: e.target.checked })} className="accent-green" />
                      Primary key
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-dim">
                      <input type="checkbox" checked={col.notNull} onChange={(e) => setCol(i, { notNull: e.target.checked })} className="accent-green" />
                      Not null
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-dim">
                      <input
                        type="checkbox"
                        checked={col.fk}
                        onChange={(e) => setCol(i, { fk: e.target.checked })}
                        className="accent-green"
                        disabled={tableNames.length === 0}
                      />
                      Foreign key
                    </label>
                  </div>

                  {col.fk && (
                    <div className="mt-2 flex items-center gap-2 px-0.5">
                      <span className="text-[11px] text-ink-faint">References</span>
                      <Select
                        className={`${fieldInput} !w-auto min-w-[120px] flex-1`}
                        value={col.fkTable}
                        onChange={(v) => setCol(i, { fkTable: v, fkColumn: '' })}
                        placeholder="table"
                        options={tableNames.map((t) => ({ value: t, label: t }))}
                      />
                      <Select
                        className={`${fieldInput} !w-auto min-w-[120px] flex-1`}
                        value={col.fkColumn}
                        onChange={(v) => setCol(i, { fkColumn: v })}
                        placeholder="column"
                        options={(schema[col.fkTable] || []).map((c) => ({ value: c, label: c }))}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-green hover:text-green-bright"
              onClick={addCol}
            >
              <PlusIcon width={14} height={14} /> Add column
            </button>

            {sql && (
              <pre className="mt-5 overflow-x-auto rounded-soft border border-edge bg-bg px-3.5 py-3 font-mono text-[11px] leading-[1.6] text-ink-dim">
                {sql}
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
