import { useState } from 'react'
import Segmented from '@/shared/ui/form/Segmented'
import { CloseIcon, FilterIcon, PlusSmall, SortIcon } from '@/shared/ui/icons'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import OptionSelect from '@/shared/ui/form/OptionSelect'

// Client-side filter + sort rules for a DataGrid, and the popover panels that
// edit them. Rules match rows by column name, so any grid whose rows are plain
// objects keyed by its column labels can use them (table tab, histories, ACLs).

const OPERATORS = [
  { value: 'contains', label: 'contains' },
  { value: '=', label: '=' },
  { value: '!=', label: '≠' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '≥' },
  { value: '<=', label: '≤' },
  { value: 'isnull', label: 'is null' },
  { value: 'notnull', label: 'is not null' },
]
const ctl =
  'rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] text-foreground outline-none focus:border-primary/25'

let filterId = 0
export const makeFilter = (col = '', op = 'contains', value = '') => ({ id: `f${++filterId}`, col, op, value, enabled: true })
const blankFilter = () => makeFilter()

export function matchFilter(row, f) {
  if (!f.enabled || !f.col) return true
  if (f.op !== 'isnull' && f.op !== 'notnull' && f.value === '') return true
  const raw = row[f.col]
  const v = raw == null ? '' : String(raw)
  switch (f.op) {
    case '=': return v === f.value
    case '!=': return v !== f.value
    case 'contains': return v.toLowerCase().includes(f.value.toLowerCase())
    case '>': return Number(raw) > Number(f.value)
    case '<': return Number(raw) < Number(f.value)
    case '>=': return Number(raw) >= Number(f.value)
    case '<=': return Number(raw) <= Number(f.value)
    case 'isnull': return raw == null
    case 'notnull': return raw != null
    default: return true
  }
}

// Multi-rule client-side sort shared by the data grid + history views. Rules
// apply in priority order (first = primary); nulls always sort last. Numeric
// when both values parse as numbers, else locale string compare. Returns the
// input untouched when there are no active rules.
export function sortRows(rows, sort) {
  const rules = (sort || []).filter((s) => s.col && s.enabled !== false)
  if (!rules.length) return rows
  return [...rows].sort((a, b) => {
    for (const { col, dir } of rules) {
      const x = a[col]
      const y = b[col]
      if (x == null && y == null) continue
      if (x == null) return 1
      if (y == null) return -1
      const nx = Number(x)
      const ny = Number(y)
      const c = !isNaN(nx) && !isNaN(ny) ? nx - ny : String(x).localeCompare(String(y))
      if (c !== 0) return dir === 'desc' ? -c : c
    }
    return 0
  })
}

// Reducer for a header click on `col`. Plain click = single-column sort cycling
// asc → desc → off. Shift (additive) = add/toggle this column within the
// multi-sort (asc → desc → removed), preserving the other rules and their order.
// A rule the user disabled in the panel is re-enabled by the click that would
// otherwise start its cycle — a header click always means "sort by this now".
export function cycleSortRules(prev, col, additive) {
  const existing = prev.find((s) => s.col === col)
  const disabled = existing && existing.enabled === false
  if (additive) {
    if (!existing) return [...prev, makeSort(col, 'asc')]
    if (disabled) return prev.map((s) => (s.col === col ? { ...s, enabled: true } : s))
    if (existing.dir === 'asc') return prev.map((s) => (s.col === col ? { ...s, dir: 'desc' } : s))
    return prev.filter((s) => s.col !== col)
  }
  if (existing && prev.length === 1) {
    if (disabled) return [{ ...existing, enabled: true }]
    return existing.dir === 'asc' ? [makeSort(col, 'desc')] : []
  }
  return [makeSort(col, 'asc')]
}

const GripIcon = (props) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden {...props}>
    <circle cx="4" cy="3" r="1" /><circle cx="8" cy="3" r="1" />
    <circle cx="4" cy="6" r="1" /><circle cx="8" cy="6" r="1" />
    <circle cx="4" cy="9" r="1" /><circle cx="8" cy="9" r="1" />
  </svg>
)

// Drag-to-reorder shared by the filter + sort rule lists: a dragged rule takes
// the slot of whichever rule it's hovering. Spread `rowProps(id)` on the rule
// row and `handleProps(id)` on its grip; `dragId` fades the row being moved.
function useRuleReorder(setDraft) {
  const [dragId, setDragId] = useState(null)
  const moveOnto = (targetId) => {
    if (!dragId || dragId === targetId) return
    setDraft((d) => {
      const from = d.findIndex((x) => x.id === dragId)
      const to = d.findIndex((x) => x.id === targetId)
      if (from < 0 || to < 0) return d
      const next = [...d]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }
  return {
    dragId,
    rowProps: (id) => ({ onDragOver: (e) => { e.preventDefault(); moveOnto(id) } }),
    handleProps: (id) => ({ draggable: true, onDragStart: () => setDragId(id), onDragEnd: () => setDragId(null) }),
  }
}

const DragHandle = (props) => (
  <span
    className="flex shrink-0 cursor-grab items-center text-faint hover:text-foreground active:cursor-grabbing"
    aria-label="Drag to reorder"
    title="Drag to reorder"
    {...props}
  >
    <GripIcon />
  </span>
)

export function FilterPanel({ columns, initial, onApply, onClose }) {
  const [draft, setDraft] = useState(() => (initial.length ? initial.map((f) => ({ ...f })) : [blankFilter()]))
  const { dragId, rowProps, handleProps } = useRuleReorder(setDraft)
  const update = (id, patch) => setDraft((d) => d.map((f) => (f.id === id ? { ...f, ...patch } : f)))

  return (
    <div className="p-3">
      <div className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-foreground">
        <FilterIcon className="text-muted-foreground" /> Filter Data
      </div>

      <div className="flex flex-col gap-2">
        {draft.map((f) => (
          <div
            key={f.id}
            {...rowProps(f.id)}
            className={`flex items-center gap-1.5 ${dragId === f.id ? 'opacity-40' : ''}`}
          >
            <DragHandle {...handleProps(f.id)} />
            <Checkbox onClick={(e) => e.stopPropagation()}
              checked={f.enabled}
              onCheckedChange={(checked) => update(f.id, { enabled: (checked === true) })}
              aria-label="Enable filter"
            />
            <OptionSelect
              className={`${ctl} min-w-0 flex-1`}
              value={f.col}
              onChange={(v) => update(f.id, { col: v })}
              placeholder="Column…"
              options={[{ value: '', label: 'Column…' }, ...columns.map((c) => ({ value: c, label: c }))]}
            />
            <OptionSelect
              className={`${ctl} w-[92px]`}
              value={f.op}
              onChange={(v) => update(f.id, { op: v })}
              options={OPERATORS}
            />
            <input
              className={`${ctl} w-[96px]`}
              placeholder="Value…"
              value={f.value}
              onChange={(e) => update(f.id, { value: e.target.value })}
            />
            <Button variant="link" size="inline" type="button"
              className="text-faint hover:text-foreground shrink-0 hover:!text-destructive"
              onClick={() => setDraft((d) => (d.length > 1 ? d.filter((x) => x.id !== f.id) : [blankFilter()]))}
              aria-label="Remove filter"
            >
              <CloseIcon width={14} height={14} />
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setDraft((d) => [...d, blankFilter()])}>
          <PlusSmall width={15} height={15} />
          Add Filter
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              onApply(draft)
              onClose()
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  )
}

let sortId = 0
export const makeSort = (col = '', dir = 'asc') => ({ id: `s${++sortId}`, col, dir, enabled: true })
const blankSort = () => makeSort()

export function SortPanel({ columns, initial, onApply, onClose }) {
  const [draft, setDraft] = useState(() => (initial.length ? initial.map((s) => ({ ...s })) : [blankSort()]))
  const { dragId, rowProps, handleProps } = useRuleReorder(setDraft)
  const update = (id, patch) => setDraft((d) => d.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  return (
    <div className="p-3">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-foreground">
        <SortIcon className="text-muted-foreground" /> Sort Data
      </div>

      <div className="flex flex-col gap-2">
        {draft.map((s, i) => (
          <div
            key={s.id}
            {...rowProps(s.id)}
            className={`flex items-center gap-1.5 ${dragId === s.id ? 'opacity-40' : ''}`}
          >
            <DragHandle {...handleProps(s.id)} />
            <Checkbox onClick={(e) => e.stopPropagation()}
              checked={s.enabled !== false}
              onCheckedChange={(checked) => update(s.id, { enabled: (checked === true) })}
              aria-label="Enable sort"
            />
            <OptionSelect
              className={`${ctl} min-w-0 flex-1`}
              value={s.col}
              onChange={(v) => update(s.id, { col: v })}
              placeholder="Column…"
              options={[{ value: '', label: 'Column…' }, ...columns.map((c) => ({ value: c, label: c }))]}
            />
            <Segmented
              className="shrink-0"
              value={s.dir}
              onChange={(v) => update(s.id, { dir: v })}
              options={[
                { value: 'asc', label: 'Asc' },
                { value: 'desc', label: 'Desc' },
              ]}
            />
            <Button variant="link" size="inline" type="button"
              className="text-faint hover:text-foreground shrink-0 hover:!text-destructive"
              onClick={() => setDraft((d) => (d.length > 1 ? d.filter((x) => x.id !== s.id) : [blankSort()]))}
              aria-label="Remove sort"
            >
              <CloseIcon width={14} height={14} />
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setDraft((d) => [...d, blankSort()])}>
          <PlusSmall width={15} height={15} />
          Add Sort
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onApply([])
              onClose()
            }}
          >
            Clear
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              onApply(draft.filter((s) => s.col))
              onClose()
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  )
}

export function ColumnsPanel({ columns, hidden, onToggle }) {
  return (
    <div className="max-h-[300px] overflow-y-auto p-2">
      <div className="px-1.5 pb-1.5 text-[11px] font-semibold text-muted-foreground">Toggle columns</div>
      {columns.map((c) => (
        <div
          key={c}
          onClick={() => onToggle(c)}
          className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Checkbox onClick={(e) => e.stopPropagation()} checked={!hidden.includes(c)} onCheckedChange={() => onToggle(c)} aria-label={`Toggle ${c}`} />
          <span className="truncate">{c}</span>
        </div>
      ))}
    </div>
  )
}
