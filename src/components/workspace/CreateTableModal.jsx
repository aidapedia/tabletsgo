import { useMemo, useState } from 'react'
import { runQuery } from '../../db/sqlite.js'
import { CloseIcon, PlusIcon, TrashIcon } from '../icons.jsx'
import Select from '../ui/Select.jsx'
import Tooltip from '../ui/Tooltip.jsx'
import { btnGhost, btnPrimary, fieldInput, fieldLabel } from '../../ui.js'

const TYPES = {
  sqlite: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'],
  postgresql: ['SERIAL', 'INTEGER', 'BIGINT', 'TEXT', 'VARCHAR(255)', 'BOOLEAN', 'TIMESTAMP', 'DATE', 'NUMERIC'],
}

const newColumn = (type) => ({ name: '', type, pk: false, notNull: false })

function buildSql(name, columns, dialect) {
  const cols = columns.filter((c) => c.name.trim())
  const defs = cols.map((c) => {
    let d = `"${c.name.trim()}" ${c.type}`
    if (c.pk) d += ' PRIMARY KEY'
    if (c.notNull && !c.pk) d += ' NOT NULL'
    return d
  })
  return `CREATE TABLE "${name.trim()}" (\n  ${defs.join(',\n  ')}\n);`
}

export default function CreateTableModal({ conn, onClose, onCreated }) {
  const dialect = conn.type === 'postgresql' ? 'postgresql' : 'sqlite'
  const types = TYPES[dialect]
  const defaultType = dialect === 'postgresql' ? 'SERIAL' : 'INTEGER'

  const [name, setName] = useState('')
  const [columns, setColumns] = useState(() => [
    { name: 'id', type: defaultType, pk: true, notNull: false },
  ])
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const setCol = (i, patch) =>
    setColumns((cols) => cols.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  const addCol = () => setColumns((cols) => [...cols, newColumn(types[dialect === 'postgresql' ? 1 : 0])])
  const removeCol = (i) => setColumns((cols) => cols.filter((_, idx) => idx !== i))

  const namedColumns = columns.filter((c) => c.name.trim())
  const valid = name.trim() && namedColumns.length > 0
  const sql = useMemo(() => (valid ? buildSql(name, columns, dialect) : ''), [name, columns, dialect, valid])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    const result = await runQuery(conn, sql)
    setSaving(false)
    if (result?.error) {
      setError(result.error)
      return
    }
    onCreated(name.trim())
  }

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[4px]"
      onMouseDown={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-[600px] animate-pop overflow-y-auto rounded-[18px] border border-edge-strong bg-panel shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          <div className="flex items-center justify-between border-b border-edge px-6 py-[22px]">
            <h3 className="text-base font-bold">Create Table</h3>
            <button
              type="button"
              className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-ink-dim hover:bg-elevated hover:text-ink"
              onClick={onClose}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="p-6">
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
            <div className="flex flex-col gap-2">
              {columns.map((col, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    className={`${fieldInput} !w-auto min-w-[130px] flex-1`}
                    type="text"
                    placeholder="column_name"
                    value={col.name}
                    onChange={(e) => setCol(i, { name: e.target.value })}
                  />
                  <Select
                    className={`${fieldInput} !w-[140px] shrink-0`}
                    value={col.type}
                    onChange={(v) => setCol(i, { type: v })}
                    options={types.map((t) => ({ value: t, label: t }))}
                  />
                  <Tooltip label="Primary key" placement="top">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-dim">
                      <input type="checkbox" checked={col.pk} onChange={(e) => setCol(i, { pk: e.target.checked })} className="accent-green" />
                      PK
                    </label>
                  </Tooltip>
                  <Tooltip label="Not null" placement="top">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-dim">
                      <input type="checkbox" checked={col.notNull} onChange={(e) => setCol(i, { notNull: e.target.checked })} className="accent-green" />
                      NN
                    </label>
                  </Tooltip>
                  <Tooltip label="Remove column" placement="top">
                    <button
                      type="button"
                      className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px] text-ink-dim hover:text-red disabled:opacity-30 disabled:hover:text-ink-dim"
                      onClick={() => removeCol(i)}
                      disabled={columns.length === 1}
                    >
                      <TrashIcon />
                    </button>
                  </Tooltip>
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

            {error && (
              <div className="mt-4 rounded-soft border border-red/25 bg-red/10 px-3.5 py-2.5 font-mono text-[11px] text-[#ff9b9b]">
                {error}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 border-t border-edge px-6 py-[18px]">
            <button type="button" className={btnGhost} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={btnPrimary} disabled={!valid || saving}>
              {saving ? 'Creating…' : 'Create Table'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
