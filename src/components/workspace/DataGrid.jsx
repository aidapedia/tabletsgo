import { useLayoutEffect, useRef, useState } from 'react'
import Checkbox from '../ui/Checkbox.jsx'

// Columns share one consistent default width and can be dragged to resize,
// regardless of how many columns the table has.
const DEFAULT_W = 180
const MIN_W = 70
const INDEX_W = 44
const thBase =
  'sticky top-0 z-[1] whitespace-nowrap border-b border-r border-edge bg-elevated px-3 py-1.5 text-left font-semibold text-ink-dim relative'
const tdBase =
  'overflow-hidden text-ellipsis whitespace-nowrap border-b border-r border-edge px-3 py-1 text-ink'
const firstTh = `${thBase} left-0 z-[2] text-right`
const firstTd = 'sticky left-0 border-b border-r border-edge bg-panel px-3 py-1 text-right tabular-nums text-ink-faint'

export default function DataGrid({
  columns,
  rows,
  selectable = false,
  getRowKey,
  selectedKeys,
  onToggleRow,
  onToggleAll,
  editable = false,
  edits,
  onEdit,
}) {
  const [editing, setEditing] = useState(null) // { rowIndex, col }
  const [draft, setDraft] = useState('')
  const [sel, setSel] = useState(null) // selected cell { r, c }
  const scrollRef = useRef(null)
  const [fill, setFill] = useState({ rowH: 24, remaining: 0 }) // empty grid fill
  const [clientW, setClientW] = useState(0) // container width (to fill horizontally)
  const [widths, setWidths] = useState({}) // per-column override widths
  const colW = (c) => widths[c] ?? DEFAULT_W

  const startResize = (e, c) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = colW(c)
    const onMove = (ev) => setWidths((p) => ({ ...p, [c]: Math.max(MIN_W, startW + ev.clientX - startX) }))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Measure leftover space so we can pad the grid with empty rows.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      const head = el.querySelector('thead')?.offsetHeight ?? 28
      const sample = el.querySelector('tbody tr[data-row]')?.offsetHeight ?? 24
      const remaining = el.clientHeight - head - rows.length * sample
      setFill((f) => {
        const next = { rowH: sample, remaining: remaining > 0 ? remaining : 0 }
        return f.rowH === next.rowH && f.remaining === next.remaining ? f : next
      })
      setClientW((w) => (w === el.clientWidth ? w : el.clientWidth))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [rows, columns])

  if (!columns || columns.length === 0) {
    return <div className="p-[30px] text-center text-ink-faint">No columns to display.</div>
  }

  const keyOf = (row, i) => (getRowKey ? getRowKey(row, i) : i)

  const startEdit = (rowIndex, col, val) => {
    setEditing({ rowIndex, col })
    setDraft(val == null ? '' : String(val))
  }
  const commitEdit = (row, currentVal) => {
    if (!editing) return
    if (String(currentVal ?? '') !== draft) onEdit?.(row, editing.col, draft)
    setEditing(null)
  }
  const allSelected = selectable && rows.length > 0 && rows.every((r, i) => selectedKeys?.has(keyOf(r, i)))
  const someSelected = selectable && !allSelected && rows.some((r, i) => selectedKeys?.has(keyOf(r, i)))

  // Spacer column fills leftover width so the grid spans the whole viewport
  // even for tables with only a few columns.
  const usedW = INDEX_W + columns.reduce((a, c) => a + colW(c), 0)
  const spacerW = Math.max(0, clientW - usedW)

  // Empty rows that pad the grid so the lines reach the bottom of the viewport.
  const fillerRow = (key, h) => (
    <tr key={key} aria-hidden className="pointer-events-none">
      <td className={firstTd} style={{ height: h }} />
      {columns.map((c, j) => (
        <td key={j} className={tdBase} style={{ height: h }} />
      ))}
      {spacerW > 0 && <td className={tdBase} style={{ height: h }} />}
    </tr>
  )
  const fillerCount = fill.remaining > 0 ? Math.floor(fill.remaining / fill.rowH) : 0
  const fillerRem = fill.remaining - fillerCount * fill.rowH
  const fillers = []
  for (let k = 0; k < fillerCount; k++) fillers.push(fillerRow(`f${k}`, fill.rowH))
  if (fillerRem > 4) fillers.push(fillerRow('frem', fillerRem))

  return (
    <div ref={scrollRef} className="relative min-h-0 w-full min-w-0 flex-1 overflow-auto">
      <table className="table-fixed border-collapse text-[11px]">
        <colgroup>
          <col style={{ width: INDEX_W }} />
          {columns.map((c) => (
            <col key={c} style={{ width: colW(c) }} />
          ))}
          {spacerW > 0 && <col style={{ width: spacerW }} />}
        </colgroup>
        <thead>
          <tr>
            <th className={firstTh}>
              {selectable ? (
                <div className="flex justify-center">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={() => onToggleAll?.()}
                    ariaLabel="Select all rows"
                  />
                </div>
              ) : (
                '#'
              )}
            </th>
            {columns.map((c) => (
              <th key={c} className={thBase}>
                <span className="block truncate">{c}</span>
                <div
                  onMouseDown={(e) => startResize(e, c)}
                  className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-green/40"
                />
              </th>
            ))}
            {spacerW > 0 && <th className={thBase} />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
              const key = keyOf(row, i)
              const selected = selectable && selectedKeys?.has(key)
              return (
                <tr key={i} data-row className={selected ? '[&>td]:bg-green/10' : 'hover:[&>td]:bg-card'}>
                  <td className={`${firstTd} ${selected ? '!bg-green/10' : ''}`}>
                    {selectable ? (
                      <div className="flex justify-center">
                        <Checkbox
                          checked={!!selected}
                          onChange={() => onToggleRow?.(row, i)}
                          ariaLabel="Select row"
                        />
                      </div>
                    ) : (
                      i + 1
                    )}
                  </td>
                  {columns.map((c, j) => {
                    const raw = Array.isArray(row) ? row[j] : row[c]
                    const rowEdits = editable && edits ? edits[key] : null
                    const dirty = rowEdits && Object.prototype.hasOwnProperty.call(rowEdits, c)
                    const val = dirty ? rowEdits[c] : raw
                    const isEditing = editable && editing && editing.rowIndex === i && editing.col === c
                    const isSel = sel && sel.r === i && sel.c === c
                    return (
                      <td
                        key={j}
                        className={`${tdBase} ${editable && !isEditing ? 'cursor-text' : ''} ${
                          dirty ? '!bg-amber/10 text-amber' : ''
                        } ${isSel && !isEditing ? '!bg-green/15 outline outline-1 -outline-offset-1 outline-green' : ''}`}
                        onClick={() => setSel({ r: i, c })}
                        onDoubleClick={() => editable && !Array.isArray(row) && !isEditing && startEdit(i, c, val)}
                        title={editable ? 'Double-click to edit' : undefined}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            className="-mx-1 w-full rounded bg-bg px-1 text-ink outline-none ring-1 ring-green"
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => commitEdit(row, val)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                commitEdit(row, val)
                              } else if (e.key === 'Escape') {
                                setEditing(null)
                              }
                            }}
                          />
                        ) : val === null || val === undefined ? (
                          <span className="italic text-ink-faint">NULL</span>
                        ) : (
                          String(val)
                        )}
                      </td>
                    )
                  })}
                  {spacerW > 0 && <td className={`${tdBase} ${selected ? '!bg-green/10' : ''}`} />}
                </tr>
              )
            })}
          {fillers}
        </tbody>
      </table>
    </div>
  )
}
