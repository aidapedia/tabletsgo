import { useLayoutEffect, useRef, useState } from 'react'
import Checkbox from '@/shared/ui/form/Checkbox'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import JsonEditor from '@/shared/ui/JsonEditor'
import NumberStepper from '@/shared/ui/form/NumberStepper'
import DatePicker from '@/shared/ui/form/DatePicker'
import TimePicker from '@/shared/ui/form/TimePicker'
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

// Map a SQL column type (+ the value) to an editor kind.
function editorKind(type, value) {
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
  const [sel, setSel] = useState(null) // selected cell { r, c }
  const scrollRef = useRef(null)
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
    <div ref={scrollRef} className="relative min-h-0 w-full min-w-0 flex-1 overflow-auto">
      <table className="table-fixed border-collapse text-[11px]" style={{ width: tableW }}>
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
            {columns.map((c) => (
              <th key={c} className={thBase}>
                <span className="block truncate">{c}</span>
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
            ))}
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
                    const isSel = sel && sel.r === i && sel.c === c
                    const ref = columnRefs?.[c]
                    const hasRef = ref && val != null && val !== ''
                    return (
                      <td
                        key={j}
                        className={`${tdBase} ${editable ? 'cursor-pointer' : ''} ${
                          dirty ? '!bg-amber/10 text-amber' : ''
                        } ${isSel ? '!bg-green/15 outline outline-1 -outline-offset-1 outline-green' : ''}`}
                        onClick={() => setSel({ r: i, c })}
                        onDoubleClick={() => editable && !Array.isArray(row) && startEdit(i, c, val)}
                        onContextMenu={(e) => {
                          if (!onCellContextMenu || Array.isArray(row)) return
                          e.preventDefault()
                          setSel({ r: i, c })
                          onCellContextMenu(e, { row, rowIndex: i, col: c, value: val })
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
        const parts = dateTimeParts(draft)
        const kindLabel = { json: 'JSON', boolean: 'Boolean', date: 'Date', time: 'Time', datetime: 'Date & time', number: 'Number' }[kind]

        return (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-6"
            onMouseDown={cancelEdit}
          >
            <div
              className="flex max-h-[80vh] w-full max-w-[640px] flex-col overflow-hidden rounded-card border border-edge-strong bg-panel shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]"
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

                  {kind === 'date' && (
                    <DatePicker autoFocus value={parts.date} onChange={(v) => setDraft(v)} />
                  )}

                  {kind === 'time' && (
                    <TimePicker autoFocus value={parts.time} onChange={(v) => setDraft(v)} />
                  )}

                  {kind === 'datetime' && (
                    <div className="flex flex-wrap gap-2">
                      <DatePicker
                        autoFocus
                        value={parts.date}
                        onChange={(v) => setDraft(joinDateTime(v, parts.time))}
                        className="flex-1"
                      />
                      <TimePicker
                        value={parts.time}
                        onChange={(v) => setDraft(joinDateTime(parts.date, v))}
                        className="flex-1"
                      />
                    </div>
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
