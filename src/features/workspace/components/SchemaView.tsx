import { useEffect, useRef, useState } from 'react'
import { getColumns, getIndexes } from '@/shared/api/database'
import LoadingState from '@/shared/ui/feedback/LoadingState'

const ROW_H = 25 // fixed row height so we can compute how many filler rows fit
const headCell =
  'sticky top-0 z-10 border-b border-r border-edge bg-elevated px-3 py-1.5 text-left text-[11px] font-semibold text-ink-dim'
const cell = 'border-b border-r border-edge px-3 py-1 text-[11px] text-ink whitespace-nowrap'
const NULL = <span className="italic text-ink-faint">NULL</span>
const DASH = <span className="text-ink-faint">—</span>

// A lightweight, spreadsheet-style grid that pads the remaining vertical space
// with empty rows so the column/row lines fill the panel. `columns` is
// [{ key, label, render }].
function Grid({ columns, rows, empty }) {
  const ref = useRef(null)
  const [fillers, setFillers] = useState(0)
  const bodyRows = rows.length || 1 // the empty-state message occupies one row

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const recompute = () => {
      const headH = el.querySelector('thead')?.offsetHeight || 0
      const free = el.clientHeight - headH - bodyRows * ROW_H
      setFillers(Math.max(0, Math.floor(free / ROW_H)))
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [bodyRows])

  return (
    <div ref={ref} className="h-full overflow-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={headCell}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr style={{ height: ROW_H }}>
              <td className={`${cell} text-ink-faint`} colSpan={columns.length}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} style={{ height: ROW_H }} className="hover:[&>td]:bg-card">
                {columns.map((c) => (
                  <td key={c.key} className={cell}>
                    {c.render(row, i)}
                  </td>
                ))}
              </tr>
            ))
          )}
          {/* Empty filler rows keep the grid lines running to the bottom. */}
          {Array.from({ length: fillers }).map((_, i) => (
            <tr key={`filler-${i}`} style={{ height: ROW_H }} aria-hidden>
              {columns.map((c) => (
                <td key={c.key} className={cell} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const structureColumns = [
  { key: 'n', label: '#', render: (_, i) => <span className="text-ink-faint">{i + 1}</span> },
  {
    key: 'name',
    label: 'column_name',
    render: (r) => (
      <span className="flex items-center gap-1.5">
        <span className="font-medium">{r.name}</span>
        {r.pk && <span className="rounded bg-green/15 px-1 text-[9px] font-bold text-green-bright">PK</span>}
      </span>
    ),
  },
  { key: 'type', label: 'data_type', render: (r) => <span className="font-mono text-ink-dim">{r.type || DASH}</span> },
  { key: 'nullable', label: 'is_nullable', render: (r) => (r.notnull ? 'NO' : 'YES') },
  { key: 'check', label: 'check', render: () => NULL },
  {
    key: 'default',
    label: 'column_default',
    render: (r) => (r.default == null ? NULL : <span className="font-mono text-ink-dim">{String(r.default)}</span>),
  },
  {
    key: 'fk',
    label: 'foreign_key',
    render: (r) =>
      r.references ? (
        <span className="font-mono text-green">
          {r.references.table}({r.references.column})
        </span>
      ) : (
        DASH
      ),
  },
  { key: 'comment', label: 'comment', render: () => NULL },
]

const indexColumns = [
  { key: 'name', label: 'index_name', render: (r) => <span className="font-medium">{r.name}</span> },
  { key: 'algorithm', label: 'index_algorithm', render: (r) => <span className="font-mono text-ink-dim">{r.algorithm || DASH}</span> },
  { key: 'unique', label: 'is_unique', render: (r) => (r.unique ? 'TRUE' : 'FALSE') },
  { key: 'columns', label: 'column_name', render: (r) => <span className="font-mono text-ink-dim">{r.columns || DASH}</span> },
  { key: 'condition', label: 'condition', render: (r) => (r.condition ? <span className="font-mono text-ink-dim">{r.condition}</span> : DASH) },
  { key: 'include', label: 'include', render: (r) => (r.include ? <span className="font-mono text-ink-dim">{r.include}</span> : DASH) },
  { key: 'comment', label: 'comment', render: (r) => (r.comment ? String(r.comment) : NULL) },
]

export default function SchemaView({ conn, table }) {
  const [columns, setColumns] = useState([])
  const [indexes, setIndexes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([getColumns(conn, table), getIndexes(conn, table)]).then(([cols, idx]) => {
      if (!alive) return
      setColumns(cols || [])
      setIndexes(idx || [])
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [conn, table])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-4 py-2.5 text-xs">
        <span className="font-semibold text-ink">{table}</span>
        <span className="text-ink-faint">
          schema · {columns.length} column(s) · {indexes.length} index(es)
        </span>
      </div>

      {loading ? (
        <LoadingState className="p-5 text-center" />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Structure grid */}
          <div className="min-h-0 flex-[3]">
            <Grid columns={structureColumns} rows={columns} empty="No columns found." />
          </div>

          {/* Indexes grid */}
          <div className="shrink-0 border-t-2 border-edge-strong bg-elevated/40 px-4 py-1.5 text-[11px] font-semibold text-ink-dim">
            Indexes
          </div>
          <div className="min-h-0 flex-[2]">
            <Grid columns={indexColumns} rows={indexes} empty="No indexes." />
          </div>
        </div>
      )}
    </div>
  )
}
