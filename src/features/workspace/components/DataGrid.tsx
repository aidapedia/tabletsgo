import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Checkbox from '@/shared/ui/form/Checkbox'
import { useToast } from '@/shared/ui/feedback/Toast'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import JsonEditor from '@/shared/ui/JsonEditor'
import NumberStepper from '@/shared/ui/form/NumberStepper'
import DateTimeField from '@/shared/ui/form/DateTimeField'
import { CloseIcon, ExternalLinkIcon } from '@/shared/ui/icons'

// JSON helpers — Postgres JSONB columns arrive as parsed objects/arrays.
// Dates arrive as JS Date objects and are handled separately (not JSON).
const isJsonValue = (v) => v !== null && typeof v === 'object' && !(v instanceof Date)
const safeStringify = (v, pretty = false) => {
  try {
    return JSON.stringify(v, null, pretty ? 2 : 0)
  } catch {
    return String(v)
  }
}
// Single-line text for a cell; objects/arrays become JSON, not "[object Object]".
export const cellText = (v) => {
  if (v == null) return ''
  if (v instanceof Date) return isoDateTime(v)
  return isJsonValue(v) ? safeStringify(v) : String(v)
}
// ---- Rectangular cell selection ----
// A selection is stored as anchor (r1,c1) → focus (r2,c2) with *column indices*,
// so a drag can run in any direction; normalize before asking "is this in it?".
const normalizeRange = (r) =>
  r && {
    r1: Math.min(r.r1, r.r2),
    r2: Math.max(r.r1, r.r2),
    c1: Math.min(r.c1, r.c2),
    c2: Math.max(r.c1, r.c2),
  }
// Tab-separated text — the format spreadsheets expect on paste.
const toTsv = (values) => values.map((row) => row.map((v) => cellText(v).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n')

// Parse a string to a JSON object/array, or null if it isn't one.
const parseJsonObject = (s) => {
  if (typeof s !== 'string') return null
  const t = s.trim()
  if (!(t.startsWith('{') || t.startsWith('['))) return null
  try {
    const p = JSON.parse(t)
    return p && typeof p === 'object' ? p : null
  } catch {
    return null
  }
}

// ---- Type-aware editing ----
const pad2 = (n) => String(n).padStart(2, '0')
const isoDateTime = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`

// Map a SQL column type (+ the value) to an editor kind. `value` only sharpens
// the guess for untyped columns, so callers that only know the type can omit it.
export function editorKind(type, value = null) {
  const t = (type || '').toLowerCase()
  if (t.includes('json') || isJsonValue(value)) return 'json'
  if (t.includes('bool')) return 'boolean'
  if (t === 'date') return 'date'
  if (t.startsWith('time') && !t.includes('stamp')) return 'time'
  if (t.includes('timestamp') || t.includes('datetime') || value instanceof Date) return 'datetime'
  if (/(int|serial|numeric|decimal|real|double|float)/.test(t)) return 'number'
  return 'text'
}

// Split a date/time value into { date: 'YYYY-MM-DD', time: 'HH:MM:SS' } parts.
function dateTimeParts(v) {
  if (v == null || v === '') return { date: '', time: '' }
  if (v instanceof Date) return { date: isoDateTime(v).slice(0, 10), time: isoDateTime(v).slice(11) }
  const s = String(v)
  const d = s.match(/\d{4}-\d{2}-\d{2}/)
  const tm = s.match(/\d{2}:\d{2}(:\d{2})?/)
  return { date: d ? d[0] : '', time: tm ? (tm[0].length === 5 ? `${tm[0]}:00` : tm[0]) : '' }
}
const joinDateTime = (date, time) => (date ? (time ? `${date} ${time}` : date) : time || '')

// Normalize a boolean-ish value to 'true' | 'false' | '' (null).
function boolText(v) {
  if (v === true || v === 1) return 'true'
  if (v === false || v === 0) return 'false'
  if (v == null || v === '') return ''
  const s = String(v).toLowerCase()
  if (['true', 't', '1', 'yes'].includes(s)) return 'true'
  if (['false', 'f', '0', 'no'].includes(s)) return 'false'
  return ''
}

// (modal opens for every edit, so no inline/needs-modal heuristic is required)

// Initial editor text for a value, given its kind.
function initialDraft(kind, value) {
  if (value == null) return ''
  switch (kind) {
    case 'json': {
      const obj = isJsonValue(value) ? value : parseJsonObject(value)
      return obj !== null ? safeStringify(obj, true) : String(value)
    }
    case 'boolean':
      return boolText(value)
    case 'datetime': {
      const p = dateTimeParts(value)
      return joinDateTime(p.date, p.time)
    }
    case 'date':
      return dateTimeParts(value).date
    case 'time':
      return dateTimeParts(value).time
    default:
      return String(value)
  }
}

// Columns start at a capped default width (so long content doesn't blow a
// column out) and can be dragged wider/narrower by the divider between headers.
const DEFAULT_W = 180 // max default width a column opens at
const MIN_W = 70
const INDEX_W = 44
const ACTIONS_W = 110
const thBase =
  'sticky top-0 z-[1] whitespace-nowrap border-b border-r border-edge bg-elevated px-3 py-1.5 text-left font-semibold text-ink-dim relative'

// Small caret shown in a sorted column header (▲ asc / ▼ desc).
const SortArrow = ({ dir }: any) => (
  <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" aria-hidden>
    {dir === 'asc' ? <path d="M5 2 L9 8 L1 8 Z" /> : <path d="M5 8 L1 2 L9 2 Z" />}
  </svg>
)
const tdBase =
  'overflow-hidden text-ellipsis whitespace-nowrap border-b border-r border-edge px-3 py-1 text-ink'
const firstTh = `${thBase} left-0 z-[2] text-right`
const firstTd = 'sticky left-0 border-b border-r border-edge bg-panel px-3 py-1 text-right tabular-nums text-ink-faint'

export default function DataGrid({
  columns,
  rows,
  columnTypes, // { [colName]: sqlType } — drives the editor input
  columnRefs, // { [colName]: { table, column } } — FK targets
  onOpenReference, // (refTable, refColumn, value) => void
  selectable = false,
  getRowKey,
  selectedKeys,
  onToggleRow,
  onToggleAll,
  editable = false,
  edits,
  onEdit,
  onCellContextMenu,
  sort, // [{ col, dir, enabled }] — sort rules (drives header carets; disabled ones are ignored)
  onSort, // (col, additive) => void — header click; additive (Shift) adds to multi-sort
  actionsLabel = 'Actions', // header text for the trailing per-row actions column
  renderRowActions, // (row, i) => ReactNode — adds a trailing actions column when set
}: any) {
  const [editing, setEditing] = useState(null) // { rowIndex, col, kind, origText }
  const [draft, setDraftState] = useState('')
  // NumberStepper commits on blur, and pressing Enter in it blurs+bubbles to
  // this modal's own Enter handler in the same tick — React state wouldn't be
  // flushed yet, so commitEdit reads this ref (always in sync) instead.
  const draftRef = useRef('')
  const setDraft = (v: string) => {
    draftRef.current = v
    setDraftState(v)
  }
  const [range, setRange] = useState(null) // cell selection { r1, c1, r2, c2 } (c = column index)
  const [dragging, setDragging] = useState(false) // mouse is painting a selection
  const draggingRef = useRef(false)
  const scrollRef = useRef(null)
  const toast = useToast()
  const [fill, setFill] = useState({ rowH: 24, remaining: 0 }) // empty grid fill
  const [clientW, setClientW] = useState(0) // container width (to fill horizontally)
  const [widths, setWidths] = useState({}) // per-column override widths
  const [resizing, setResizing] = useState(null) // column currently being dragged
  const colW = (c) => widths[c] ?? DEFAULT_W

  const startResize = (e, c) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = colW(c)
    setResizing(c)
    const onMove = (ev) => setWidths((p) => ({ ...p, [c]: Math.max(MIN_W, startW + ev.clientX - startX) }))
    const onUp = () => {
      setResizing(null)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // A drag can end anywhere (outside the grid, outside the window), so the
  // release is watched globally rather than on the cells.
  useEffect(() => {
    const stop = () => {
      draggingRef.current = false
      setDragging(false)
    }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  // Row/column indices are only meaningful for the data currently on screen —
  // a page change, re-sort or column toggle invalidates the selection.
  useEffect(() => setRange(null), [rows, columns])

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

  // The value the grid shows for a cell — the pending edit when there is one.
  const cellValue = (row, i, j) => {
    const c = columns[j]
    const raw = Array.isArray(row) ? row[j] : row[c]
    const rowEdits = editable && edits ? edits[keyOf(row, i)] : null
    return rowEdits && Object.prototype.hasOwnProperty.call(rowEdits, c) ? rowEdits[c] : raw
  }

  // ---- Cell range selection (click-drag, Shift+click) ----
  const box = normalizeRange(range)
  const inBox = (i, j) => !!box && i >= box.r1 && i <= box.r2 && j >= box.c1 && j <= box.c2

  // Everything the selection covers, in the grid's own order — handed to the
  // context menu so callers can copy/act on it without redoing the geometry.
  const selectionPayload = () => {
    if (!box) return null
    const rowIndexes = []
    for (let i = box.r1; i <= Math.min(box.r2, rows.length - 1); i++) rowIndexes.push(i)
    const colIndexes = []
    for (let j = box.c1; j <= Math.min(box.c2, columns.length - 1); j++) colIndexes.push(j)
    return {
      rows: rowIndexes.map((i) => rows[i]),
      columns: colIndexes.map((j) => columns[j]),
      values: rowIndexes.map((i) => colIndexes.map((j) => cellValue(rows[i], i, j))),
      rowCount: rowIndexes.length,
      colCount: colIndexes.length,
      cellCount: rowIndexes.length * colIndexes.length,
    }
  }

  const startSelect = (e, i, j) => {
    if (e.button !== 0) return
    // Suppress the browser's own text selection during the drag; focus is moved
    // by hand since preventDefault() also cancels the implicit focus.
    e.preventDefault()
    scrollRef.current?.focus()
    if (e.shiftKey && range) setRange((p) => ({ ...p, r2: i, c2: j }))
    else {
      setRange({ r1: i, c1: j, r2: i, c2: j })
      draggingRef.current = true
      setDragging(true)
    }
  }
  const extendSelect = (i, j) => {
    if (draggingRef.current) setRange((p) => (p ? { ...p, r2: i, c2: j } : p))
  }

  const copySelection = async () => {
    const s = selectionPayload()
    if (!s) return
    try {
      await navigator.clipboard.writeText(toTsv(s.values))
      toast.success(`Copied ${s.cellCount} cell${s.cellCount > 1 ? 's' : ''}`)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  const onGridKeyDown = (e) => {
    if (editing) return
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && box) {
      e.preventDefault()
      copySelection()
    } else if (e.key === 'Escape' && box) {
      setRange(null)
    }
  }

  // All edits open a type-aware modal (never inline).
  const startEdit = (rowIndex, col, val) => {
    const kind = editorKind(columnTypes?.[col], val)
    const text = initialDraft(kind, val)
    setEditing({ rowIndex, col, kind, origText: text })
    setDraft(text)
  }
  const commitEdit = () => {
    if (!editing) return
    const row = rows[editing.rowIndex]
    if (draftRef.current !== editing.origText) onEdit?.(row, editing.col, draftRef.current)
    setEditing(null)
  }
  const cancelEdit = () => setEditing(null)
  // Re-format the JSON draft (used by the modal's Format button).
  const formatJson = () => {
    try {
      setDraft(JSON.stringify(JSON.parse(draft), null, 2))
    } catch {
      /* leave invalid JSON untouched */
    }
  }
  // col -> { dir, index } so headers can render a caret and (when multi) a priority
  // number. A rule the user disabled in the sort panel doesn't sort, so it gets no caret.
  const activeSort = (sort || []).filter((s: any) => s?.col && s.enabled !== false)
  const sortByCol: Record<string, { dir: string; index: number }> = {}
  activeSort.forEach((s: any, i: number) => { sortByCol[s.col] = { dir: s.dir, index: i } })
  const multiSort = activeSort.length > 1

  const allSelected = selectable && rows.length > 0 && rows.every((r, i) => selectedKeys?.has(keyOf(r, i)))
  const someSelected = selectable && !allSelected && rows.some((r, i) => selectedKeys?.has(keyOf(r, i)))

  // Spacer column fills leftover width so the grid spans the whole viewport
  // even for tables with only a few columns.
  const usedW = INDEX_W + columns.reduce((a, c) => a + colW(c), 0) + (renderRowActions ? ACTIONS_W : 0)
  const spacerW = Math.max(0, clientW - usedW)
  // Explicit table width so `table-fixed` keeps every column at its own width:
  // when the columns outgrow the container the table overflows (horizontal
  // scroll) instead of the browser squeezing neighbouring columns to fit.
  const tableW = usedW + spacerW

  // Empty rows that pad the grid so the lines reach the bottom of the viewport.
  const fillerRow = (key, h) => (
    <tr key={key} aria-hidden className="pointer-events-none">
      <td className={firstTd} style={{ height: h }} />
      {columns.map((c, j) => (
        <td key={j} className={tdBase} style={{ height: h }} />
      ))}
      {renderRowActions && <td className={tdBase} style={{ height: h }} />}
      {spacerW > 0 && <td className={tdBase} style={{ height: h }} />}
    </tr>
  )
  const fillerCount = fill.remaining > 0 ? Math.floor(fill.remaining / fill.rowH) : 0
  const fillerRem = fill.remaining - fillerCount * fill.rowH
  const fillers = []
  for (let k = 0; k < fillerCount; k++) fillers.push(fillerRow(`f${k}`, fill.rowH))
  if (fillerRem > 4) fillers.push(fillerRow('frem', fillerRem))

  return (
    <>
    <div
      ref={scrollRef}
      tabIndex={-1}
      onKeyDown={onGridKeyDown}
      className="relative min-h-0 w-full min-w-0 flex-1 overflow-auto outline-none"
    >
      <table
        className={`table-fixed border-collapse text-[11px] ${dragging ? 'select-none' : ''}`}
        style={{ width: tableW }}
      >
        <colgroup>
          <col style={{ width: INDEX_W }} />
          {columns.map((c) => (
            <col key={c} style={{ width: colW(c) }} />
          ))}
          {renderRowActions && <col style={{ width: ACTIONS_W }} />}
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
            {columns.map((c) => {
              const sc = sortByCol[c]
              return (
              <th key={c} className={thBase}>
                <div
                  className={`flex items-center gap-1 ${onSort ? 'cursor-pointer select-none hover:text-ink' : ''}`}
                  onClick={onSort ? (e) => onSort(c, e.shiftKey) : undefined}
                  title={onSort ? 'Click to sort · Shift+click to add to sort' : undefined}
                >
                  <span className="block min-w-0 truncate">{c}</span>
                  {sc && (
                    <span className="flex shrink-0 items-center gap-0.5 text-green">
                      <SortArrow dir={sc.dir} />
                      {multiSort && <span className="text-[9px] font-bold leading-none">{sc.index + 1}</span>}
                    </span>
                  )}
                </div>
                <div
                  onMouseDown={(e) => startResize(e, c)}
                  className={`absolute right-0 top-0 z-10 h-full cursor-col-resize transition-colors ${
                    resizing === c ? 'w-0.5 bg-green' : 'w-1.5'
                  }`}
                >
                  {/* Full-height guide, anchored to the handle so it sits exactly
                      on the column boundary (no width math to drift out of sync). */}
                  {resizing === c && (
                    <div className="pointer-events-none absolute right-0 top-0 h-[100vh] w-0.5 bg-green" />
                  )}
                </div>
              </th>
            )})}
            {renderRowActions && <th className={thBase}>{actionsLabel}</th>}
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
                    const isSel = inBox(i, j)
                    // Only the rectangle's outer edges get a line, so a
                    // multi-cell selection reads as one block instead of a mesh
                    // of boxes. Inset shadows (not borders) — they don't take up
                    // space, so selecting never nudges the layout.
                    const ringStyle = isSel
                      ? {
                          boxShadow: [
                            i === box.r1 && 'inset 0 1px 0 0 var(--color-green)',
                            i === box.r2 && 'inset 0 -1px 0 0 var(--color-green)',
                            j === box.c1 && 'inset 1px 0 0 0 var(--color-green)',
                            j === box.c2 && 'inset -1px 0 0 0 var(--color-green)',
                          ]
                            .filter(Boolean)
                            .join(', '),
                        }
                      : undefined
                    const ref = columnRefs?.[c]
                    const hasRef = ref && val != null && val !== ''
                    return (
                      <td
                        key={j}
                        className={`${tdBase} ${editable ? 'cursor-pointer' : ''} ${
                          dirty ? '!bg-amber/10 text-amber' : ''
                        } ${isSel ? '!bg-green/15' : ''}`}
                        style={ringStyle}
                        onMouseDown={(e) => startSelect(e, i, j)}
                        onMouseEnter={() => extendSelect(i, j)}
                        onDoubleClick={() => editable && !Array.isArray(row) && startEdit(i, c, val)}
                        onContextMenu={(e) => {
                          if (!onCellContextMenu || Array.isArray(row)) return
                          e.preventDefault()
                          // Right-clicking outside the selection moves it, the
                          // way every spreadsheet behaves; inside, it's kept.
                          const keep = inBox(i, j)
                          if (!keep) setRange({ r1: i, c1: j, r2: i, c2: j })
                          onCellContextMenu(e, {
                            row,
                            rowIndex: i,
                            col: c,
                            value: val,
                            selection: keep
                              ? selectionPayload()
                              : { rows: [row], columns: [c], values: [[val]], rowCount: 1, colCount: 1, cellCount: 1 },
                          })
                        }}
                        title={editable ? 'Double-click to edit' : undefined}
                      >
                        {val === null || val === undefined ? (
                          <span className="italic text-ink-faint">NULL</span>
                        ) : hasRef ? (
                          <div className="group/fk flex items-center gap-1">
                            <span className="min-w-0 flex-1 truncate">{cellText(val)}</span>
                            <Tooltip label={`Open ${ref.table} where ${ref.column} = ${cellText(val)}`} placement="left">
                              <TextButton
                                tone="faint"
                                onClick={(e) => { e.stopPropagation(); onOpenReference?.(ref.table, ref.column, val) }}
                                onDoubleClick={(e) => e.stopPropagation()}
                                aria-label={`Open ${ref.table}`}
                                className="shrink-0 opacity-0 hover:!text-green group-hover/fk:opacity-100"
                              >
                                <ExternalLinkIcon width={13} height={13} />
                              </TextButton>
                            </Tooltip>
                          </div>
                        ) : (
                          cellText(val)
                        )}
                      </td>
                    )
                  })}
                  {renderRowActions && (
                    <td
                      className={`${tdBase} whitespace-normal ${selected ? '!bg-green/10' : ''}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {renderRowActions(row, i)}
                    </td>
                  )}
                  {spacerW > 0 && <td className={`${tdBase} ${selected ? '!bg-green/10' : ''}`} />}
                </tr>
              )
            })}
          {fillers}
        </tbody>
      </table>
    </div>

    {/* Type-aware modal editor */}
    {editing &&
      (() => {
        const kind = editing.kind
        const isTextArea = kind === 'json' || kind === 'text'
        const kindLabel = { json: 'JSON', boolean: 'Boolean', date: 'Date', time: 'Time', datetime: 'Date & time', number: 'Number' }[kind]

        return (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-6"
            onMouseDown={cancelEdit}
          >
            <div
              className="flex max-h-[80vh] w-full max-w-[640px] flex-col overflow-hidden rounded-card border border-edge-strong bg-panel"
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancelEdit()
                else if (e.key === 'Enter') {
                  if (isTextArea) {
                    if (e.metaKey || e.ctrlKey) { e.preventDefault(); commitEdit() }
                  } else {
                    e.preventDefault()
                    commitEdit()
                  }
                }
              }}
            >
              <div className="flex items-center justify-between border-b border-edge px-4 py-3">
                <span className="text-xs font-semibold text-ink">
                  Edit <span className="font-mono text-ink-dim">{editing.col}</span>
                  {kindLabel && <span className="ml-1.5 rounded bg-green/15 px-1.5 text-[10px] font-bold text-green-bright">{kindLabel}</span>}
                </span>
                <TextButton tone="faint" onClick={cancelEdit} aria-label="Close">
                  <CloseIcon width={16} height={16} />
                </TextButton>
              </div>

              {kind === 'json' ? (
                <JsonEditor
                  autoFocus
                  value={draft}
                  onChange={setDraft}
                  placeholder="NULL"
                  wrapperClassName="min-h-[260px] flex-1 bg-bg"
                />
              ) : isTextArea ? (
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  placeholder="NULL"
                  className="min-h-[260px] flex-1 resize-none bg-bg px-4 py-3 font-mono text-[12px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
                />
              ) : (
                <div className="flex flex-col gap-3 px-4 py-5">
                  {kind === 'number' && (
                    <NumberStepper
                      autoFocus
                      allowNull
                      value={draft === '' ? null : Number(draft)}
                      onChange={(n) => setDraft(n === null ? '' : String(n))}
                      min={-Infinity}
                      max={Infinity}
                      ariaLabel={editing.col}
                      placeholder="NULL"
                      className="w-full"
                    />
                  )}

                  {kind === 'boolean' && (
                    <div className="flex gap-2">
                      {['true', 'false', ''].map((v) => (
                        <Button
                          key={v || 'null'}
                          variant={draft === v ? 'primary' : 'ghost'}
                          size="sm"
                          onClick={() => setDraft(v)}
                        >
                          {v === '' ? 'NULL' : v === 'true' ? 'True' : 'False'}
                        </Button>
                      ))}
                    </div>
                  )}

                  {(kind === 'date' || kind === 'time' || kind === 'datetime') && (
                    <DateTimeField autoFocus kind={kind} value={draft} onChange={setDraft} />
                  )}

                  {(kind === 'date' || kind === 'time' || kind === 'datetime' || kind === 'number') && (
                    <TextButton tone="faint" className="self-start !text-[11px] hover:!text-ink" onClick={() => setDraft('')}>
                      Set NULL
                    </TextButton>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 border-t border-edge px-4 py-3">
                <div>
                  {kind === 'json' && (
                    <Button variant="subtle" size="sm" onClick={formatJson}>
                      Format JSON
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isTextArea && <span className="mr-1 hidden text-[10px] text-ink-faint sm:inline">⌘↵ to save</span>}
                  <Button variant="ghost" size="sm" onClick={cancelEdit}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" onClick={commitEdit}>
                    Save
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </>
  )
}
