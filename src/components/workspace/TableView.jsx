import { useEffect, useMemo, useState } from 'react'
import { getTableData } from '../../db/sqlite.js'
import DataGrid from './DataGrid.jsx'
import InsertRowPanel from './InsertRowPanel.jsx'
import Button from '../ui/Button.jsx'
import Popover from '../ui/Popover.jsx'
import Select from '../ui/Select.jsx'
import {
  ChevronLeft,
  ChevronRight,
  CloseIcon,
  ColumnsIcon,
  DownloadIcon,
  FilterIcon,
  PlusSmall,
  RefreshIcon,
  SortIcon,
} from '../icons.jsx'

const OPERATORS = [
  { value: 'contains', label: 'contains' },
  { value: '=', label: '=' },
  { value: '!=', label: '≠' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '≥' },
  { value: '<=', label: '≤' },
]
const PAGE_SIZES = [25, 50, 100, 200]

const ctl =
  'rounded-soft border border-edge bg-bg px-2.5 py-1.5 text-[11px] text-ink outline-none focus:border-green-dim'
const menuItem =
  'flex w-full rounded px-3 py-1.5 text-left text-[11px] text-ink-dim transition-colors hover:bg-card-hover hover:text-ink'

let filterId = 0
const blankFilter = () => ({ id: `f${++filterId}`, col: '', op: 'contains', value: '', enabled: true })

function matchFilter(row, f) {
  if (!f.enabled || !f.col || f.value === '') return true
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
    default: return true
  }
}

export default function TableView({ conn, table }) {
  const [columns, setColumns] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInsert, setShowInsert] = useState(false)

  const [filters, setFilters] = useState([])
  const [sort, setSort] = useState(null) // { col, dir }
  const [hidden, setHidden] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const load = async () => {
    setLoading(true)
    const result = await getTableData(conn, table)
    setColumns(result.columns || [])
    setRows(result.rows || [])
    setLoading(false)
  }

  useEffect(() => {
    setFilters([])
    setSort(null)
    setHidden([])
    setPage(1)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, table])

  const filtered = useMemo(() => rows.filter((r) => filters.every((f) => matchFilter(r, f))), [rows, filters])

  const sorted = useMemo(() => {
    if (!sort?.col) return filtered
    const { col, dir } = sort
    return [...filtered].sort((a, b) => {
      const x = a[col]
      const y = b[col]
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      const nx = Number(x)
      const ny = Number(y)
      const c = !isNaN(nx) && !isNaN(ny) ? nx - ny : String(x).localeCompare(String(y))
      return dir === 'desc' ? -c : c
    })
  }, [filtered, sort])

  const visibleColumns = useMemo(() => columns.filter((c) => !hidden.includes(c)), [columns, hidden])

  const total = sorted.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  useEffect(() => setPage((p) => Math.min(Math.max(1, p), pageCount)), [pageCount])
  const pageRows = useMemo(() => sorted.slice((page - 1) * pageSize, page * pageSize), [sorted, page, pageSize])

  const activeFilterCount = filters.filter((f) => f.enabled && f.col && f.value !== '').length

  const exportCsv = () => {
    const esc = (v) => {
      if (v == null) return ''
      const s = String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [
      visibleColumns.join(','),
      ...sorted.map((r) => visibleColumns.map((c) => esc(r[c])).join(',')),
    ].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${table}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const toggleColumn = (c) =>
    setHidden((h) => (h.includes(c) ? h.filter((x) => x !== c) : [...h, c]))

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Toolbar / action list */}
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        <Button variant="primary" size="sm" icon={PlusSmall} onClick={() => setShowInsert(true)} disabled={loading}>
          Insert
        </Button>
        <Button variant="subtle" size="sm" icon={RefreshIcon} onClick={load} disabled={loading}>
          Refresh
        </Button>

        <div className="mx-0.5 h-5 w-px bg-edge" />

        <Popover
          width={380}
          trigger={({ open, toggle }) => (
            <Button variant="subtle" size="sm" icon={FilterIcon} active={open || activeFilterCount > 0} onClick={toggle}>
              {activeFilterCount > 0 ? `Filtered by ${activeFilterCount} rule${activeFilterCount > 1 ? 's' : ''}` : 'Filter'}
            </Button>
          )}
        >
          {({ close }) => (
            <FilterPanel
              columns={columns}
              initial={filters}
              onApply={(f) => {
                setFilters(f)
                setPage(1)
              }}
              onClose={close}
            />
          )}
        </Popover>

        <Popover
          width={260}
          trigger={({ open, toggle }) => (
            <Button variant="subtle" size="sm" icon={SortIcon} active={open || !!sort} onClick={toggle}>
              {sort ? 'Sorted by 1 rule' : 'Sort'}
            </Button>
          )}
        >
          {({ close }) => (
            <SortPanel
              columns={columns}
              value={sort}
              onChange={(s) => {
                setSort(s)
                setPage(1)
              }}
              onClose={close}
            />
          )}
        </Popover>

        <Button variant="subtle" size="sm" icon={DownloadIcon} onClick={exportCsv} disabled={!sorted.length}>
          Export
        </Button>

        {/* Right cluster */}
        <div className="ml-auto flex items-center gap-1">
          <Popover
            align="right"
            width={220}
            trigger={({ open, toggle }) => (
              <Button variant="subtle" size="sm" active={open} onClick={toggle} className="!px-2" aria-label="Toggle columns">
                <ColumnsIcon width={15} height={15} />
              </Button>
            )}
          >
            <ColumnsPanel columns={columns} hidden={hidden} onToggle={toggleColumn} />
          </Popover>

          <div className="mx-0.5 h-5 w-px bg-edge" />

          <Button
            variant="subtle"
            size="sm"
            className="!px-2"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            aria-label="Previous page"
          >
            <ChevronLeft width={16} height={16} />
          </Button>
          <span className="px-1 text-[11px] text-ink">
            {page} <span className="text-ink-faint">of {pageCount}</span>
          </span>
          <Button
            variant="subtle"
            size="sm"
            className="!px-2"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            aria-label="Next page"
          >
            <ChevronRight width={16} height={16} />
          </Button>

          <Popover
            align="right"
            width={120}
            trigger={({ open, toggle }) => (
              <Button variant="subtle" size="sm" chevron active={open} onClick={toggle}>
                {pageSize} rows
              </Button>
            )}
          >
            {({ close }) => (
              <div className="p-1">
                {PAGE_SIZES.map((s) => (
                  <button
                    key={s}
                    className={menuItem}
                    onClick={() => {
                      setPageSize(s)
                      setPage(1)
                      close()
                    }}
                  >
                    {s} rows
                  </button>
                ))}
              </div>
            )}
          </Popover>

          <span className="pl-1 text-[11px] text-ink-faint">{total} rows</span>
        </div>
      </div>

      {loading ? (
        <div className="p-5 text-center text-xs">Loading…</div>
      ) : (
        <DataGrid columns={visibleColumns} rows={pageRows} />
      )}

      {showInsert && (
        <InsertRowPanel
          conn={conn}
          table={table}
          onClose={() => setShowInsert(false)}
          onSaved={() => {
            setShowInsert(false)
            load()
          }}
        />
      )}
    </div>
  )
}

function FilterPanel({ columns, initial, onApply, onClose }) {
  const [draft, setDraft] = useState(() => (initial.length ? initial.map((f) => ({ ...f })) : [blankFilter()]))
  const update = (id, patch) => setDraft((d) => d.map((f) => (f.id === id ? { ...f, ...patch } : f)))

  return (
    <div className="p-3">
      <div className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-ink">
        <FilterIcon className="text-ink-dim" /> Filter Data
      </div>
      <div className="mb-3 rounded-soft border border-edge bg-bg px-3 py-2 text-[11px] text-ink-faint">
        e.g. status = active and revenue &gt; 100
      </div>

      <div className="flex flex-col gap-2">
        {draft.map((f) => (
          <div key={f.id} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={f.enabled}
              onChange={(e) => update(f.id, { enabled: e.target.checked })}
              className="accent-green"
            />
            <Select
              className={`${ctl} min-w-0 flex-1`}
              value={f.col}
              onChange={(v) => update(f.id, { col: v })}
              placeholder="Column…"
              options={[{ value: '', label: 'Column…' }, ...columns.map((c) => ({ value: c, label: c }))]}
            />
            <Select
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
            <button
              className="shrink-0 text-ink-faint hover:text-red"
              onClick={() => setDraft((d) => (d.length > 1 ? d.filter((x) => x.id !== f.id) : [blankFilter()]))}
              aria-label="Remove filter"
            >
              <CloseIcon width={14} height={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <Button variant="subtle" size="sm" icon={PlusSmall} onClick={() => setDraft((d) => [...d, blankFilter()])}>
          Add Filter
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
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

function SortPanel({ columns, value, onChange, onClose }) {
  const [col, setCol] = useState(value?.col || '')
  const [dir, setDir] = useState(value?.dir || 'asc')

  return (
    <div className="p-3">
      <div className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-ink">
        <SortIcon className="text-ink-dim" /> Sort
      </div>
      <Select
        className={`${ctl} mb-2 w-full`}
        value={col}
        onChange={setCol}
        placeholder="No sorting"
        options={[{ value: '', label: 'No sorting' }, ...columns.map((c) => ({ value: c, label: c }))]}
      />
      <div className="mb-3 flex gap-1.5">
        <Button variant={dir === 'asc' ? 'primary' : 'ghost'} size="sm" className="flex-1" onClick={() => setDir('asc')}>
          Ascending
        </Button>
        <Button variant={dir === 'desc' ? 'primary' : 'ghost'} size="sm" className="flex-1" onClick={() => setDir('desc')}>
          Descending
        </Button>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange(null)
            onClose()
          }}
        >
          Clear
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            onChange(col ? { col, dir } : null)
            onClose()
          }}
        >
          Apply
        </Button>
      </div>
    </div>
  )
}

function ColumnsPanel({ columns, hidden, onToggle }) {
  return (
    <div className="max-h-[300px] overflow-y-auto p-2">
      <div className="px-1.5 pb-1.5 text-[11px] font-semibold text-ink-dim">Toggle columns</div>
      {columns.map((c) => (
        <label
          key={c}
          className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-[11px] text-ink-dim hover:bg-card-hover hover:text-ink"
        >
          <input type="checkbox" checked={!hidden.includes(c)} onChange={() => onToggle(c)} className="accent-green" />
          <span className="truncate">{c}</span>
        </label>
      ))}
    </div>
  )
}
