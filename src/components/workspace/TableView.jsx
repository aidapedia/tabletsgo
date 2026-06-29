import { useEffect, useMemo, useState } from 'react'
import { getColumns, getTableData } from '../../db/sqlite.js'
import { useSettings } from '../../context/SettingsContext.jsx'
import DataGrid from './DataGrid.jsx'
import InsertRowPanel from './InsertRowPanel.jsx'
import Button from '../ui/Button.jsx'
import Checkbox from '../ui/Checkbox.jsx'
import Popover from '../ui/Popover.jsx'
import Select from '../ui/Select.jsx'
import { useToast } from '../ui/Toast.jsx'
import {
  ChevronLeft,
  ChevronRight,
  CloseIcon,
  ColumnsIcon,
  CopyIcon,
  DownloadIcon,
  FilterIcon,
  PlusSmall,
  RefreshIcon,
  SaveIcon,
  SortIcon,
  TrashIcon,
} from '../icons.jsx'

// Quote a JS value for inline SQL (dev tool — table is trusted, values escaped).
const sqlValue = (v) => {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return `'${String(v).replace(/'/g, "''")}'`
}

const OPERATORS = [
  { value: 'contains', label: 'contains' },
  { value: '=', label: '=' },
  { value: '!=', label: '≠' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '≥' },
  { value: '<=', label: '≤' },
]
export const PAGE_SIZES = [25, 50, 100, 200]

const ctl =
  'rounded-soft border border-edge bg-bg px-2.5 py-1.5 text-[11px] text-ink outline-none focus:border-green-dim'
export const gridMenuItem =
  'flex w-full rounded px-3 py-1.5 text-left text-[11px] text-ink-dim transition-colors hover:bg-card-hover hover:text-ink'
const menuItem = gridMenuItem

let filterId = 0
const blankFilter = () => ({ id: `f${++filterId}`, col: '', op: 'contains', value: '', enabled: true })

export function matchFilter(row, f) {
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

export default function TableView({ conn, table, onChange }) {
  const toast = useToast()
  const { tableRowLimit } = useSettings()
  const [columns, setColumns] = useState([])
  const [rows, setRows] = useState([])
  const [pkCols, setPkCols] = useState([])
  const [colTypes, setColTypes] = useState({}) // { colName: sqlType } for the editor
  const [loading, setLoading] = useState(true)
  const [showInsert, setShowInsert] = useState(false)
  const [selected, setSelected] = useState(() => new Set()) // row keys
  const [edits, setEdits] = useState({}) // unsaved inline edits: { rowKey: { where, values } }

  const [filters, setFilters] = useState([])
  const [sort, setSort] = useState(null) // { col, dir }
  const [hidden, setHidden] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const load = async () => {
    setLoading(true)
    const [result, meta] = await Promise.all([getTableData(conn, table, tableRowLimit), getColumns(conn, table)])
    setColumns(result.columns || [])
    setRows(result.rows || [])
    setPkCols((meta || []).filter((c) => c.pk).map((c) => c.name))
    setColTypes(Object.fromEntries((meta || []).map((c) => [c.name, c.type])))
    setSelected(new Set())
    setEdits({})
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

  // Rows are targeted by primary key when available; otherwise we fall back to
  // matching every column so selection / delete / duplicate work on any table.
  const identCols = pkCols.length ? pkCols : columns
  const selectable = columns.length > 0
  const rowKey = (row) => identCols.map((c) => String(row[c])).join('¦')
  const rowWhere = (row) =>
    identCols.map((c) => (row[c] == null ? `"${c}" IS NULL` : `"${c}" = ${sqlValue(row[c])}`)).join(' AND ')

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

  // ---- Row selection + bulk actions ----
  const toggleRow = (row) => {
    const k = rowKey(row)
    setSelected((s) => {
      const n = new Set(s)
      n.has(k) ? n.delete(k) : n.add(k)
      return n
    })
  }
  const toggleAll = () => {
    setSelected((s) => {
      const allOnPage = pageRows.length > 0 && pageRows.every((r) => s.has(rowKey(r)))
      const n = new Set(s)
      pageRows.forEach((r) => (allOnPage ? n.delete(rowKey(r)) : n.add(rowKey(r))))
      return n
    })
  }
  const clearSelection = () => setSelected(new Set())
  const selectedRows = () => rows.filter((r) => selected.has(rowKey(r)))

  const insertSql = (values) => {
    const cols = Object.keys(values)
    return `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols
      .map((c) => sqlValue(values[c]))
      .join(', ')})`
  }

  // Actions stage SQL into Changes; nothing executes until the user commits.
  const deleteSelected = () => {
    const targets = selectedRows()
    if (!targets.length) return
    const sql = `DELETE FROM "${table}" WHERE ${targets.map((r) => `(${rowWhere(r)})`).join(' OR ')}`
    onChange?.({ kind: 'delete', label: `Delete ${targets.length} row(s)`, sql, table })
    toast.info(`Added delete to changes — commit to apply.`)
    clearSelection()
  }

  const duplicateSelected = () => {
    const targets = selectedRows()
    if (!targets.length) return
    for (const row of targets) {
      const values = {}
      for (const c of columns) if (!pkCols.includes(c)) values[c] = row[c]
      onChange?.({ kind: 'duplicate', label: 'Duplicate row', sql: insertSql(values), table })
    }
    toast.info(`Added ${targets.length} insert(s) to changes — commit to apply.`)
    clearSelection()
  }

  const stageInsert = (values) => {
    onChange?.({ kind: 'insert', label: 'Insert row', sql: insertSql(values), table })
    toast.info('Added insert to changes — commit to apply.')
  }

  // Inline cell edit → held locally as an unsaved edit (not staged yet).
  const editCell = (row, col, value) => {
    const k = rowKey(row)
    setEdits((e) => {
      const cur = e[k] || { where: rowWhere(row), values: {} }
      const values = { ...cur.values }
      // Editing back to the original value clears the pending edit for that cell.
      if (String(row[col] ?? '') === String(value)) delete values[col]
      else values[col] = value
      const next = { ...e }
      if (Object.keys(values).length === 0) delete next[k]
      else next[k] = { where: cur.where, values }
      return next
    })
  }

  // Cell overlay the grid renders (rowKey -> { col: value }).
  const editOverlay = useMemo(() => {
    const o = {}
    for (const [k, { values }] of Object.entries(edits)) o[k] = values
    return o
  }, [edits])
  const editCount = useMemo(
    () => Object.values(edits).reduce((n, e) => n + Object.keys(e.values).length, 0),
    [edits]
  )

  // Save all pending edits → one UPDATE per row, added to staged changes.
  const saveEdits = () => {
    const entries = Object.values(edits)
    if (!entries.length) return
    for (const { where, values } of entries) {
      const setClause = Object.entries(values)
        .map(([c, v]) => `"${c}" = ${v === '' ? 'NULL' : sqlValue(v)}`)
        .join(', ')
      onChange?.({ kind: 'update', label: `Update row in ${table}`, sql: `UPDATE "${table}" SET ${setClause} WHERE ${where}`, table })
    }
    setEdits({})
    toast.info(`Added ${entries.length} update(s) to changes — commit to apply.`)
  }
  const discardEdits = () => setEdits({})

  const selCount = selected.size

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Toolbar / action list — the left actions swap to Save/Discard while
          there are unsaved cell edits, or to bulk actions while rows are
          selected; the right cluster (columns, pagination, page size) stays
          visible in every state. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        {editCount > 0 ? (
          <>
            <Button variant="primary" size="sm" icon={SaveIcon} onClick={saveEdits}>
              Save
            </Button>
            <Button variant="subtle" size="sm" onClick={discardEdits}>
              Discard
            </Button>

            <div className="mx-0.5 h-5 w-px bg-edge" />

            <span className="text-[11px] font-semibold text-amber">
              {editCount} unsaved edit{editCount > 1 ? 's' : ''}
            </span>
          </>
        ) : selCount > 0 ? (
          <>
            <Button variant="primary" size="sm" icon={TrashIcon} onClick={deleteSelected}
              className="!bg-red !text-white hover:!bg-red/90">
              Delete
            </Button>
            <Button variant="subtle" size="sm" icon={CopyIcon} onClick={duplicateSelected}>
              Duplicate
            </Button>

            <div className="mx-0.5 h-5 w-px bg-edge" />

            <span className="text-[11px] font-semibold text-ink">{selCount} selected</span>

            <Button variant="subtle" size="sm" className="!px-2" onClick={clearSelection} aria-label="Clear selection">
              <CloseIcon width={16} height={16} />
            </Button>
          </>
        ) : (
          <>
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
          </>
        )}

        {/* Right cluster — columns / pagination / page size — always visible */}
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
        <DataGrid
          columns={visibleColumns}
          rows={pageRows}
          columnTypes={colTypes}
          selectable={selectable}
          getRowKey={rowKey}
          selectedKeys={selected}
          onToggleRow={toggleRow}
          onToggleAll={toggleAll}
          editable={selectable}
          edits={editOverlay}
          onEdit={editCell}
        />
      )}

      {showInsert && (
        <InsertRowPanel
          conn={conn}
          table={table}
          onClose={() => setShowInsert(false)}
          onStage={(values) => {
            stageInsert(values)
            setShowInsert(false)
          }}
        />
      )}
    </div>
  )
}

export function FilterPanel({ columns, initial, onApply, onClose }) {
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
            <Checkbox
              checked={f.enabled}
              onChange={(v) => update(f.id, { enabled: v })}
              ariaLabel="Enable filter"
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

export function SortPanel({ columns, value, onChange, onClose }) {
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

export function ColumnsPanel({ columns, hidden, onToggle }) {
  return (
    <div className="max-h-[300px] overflow-y-auto p-2">
      <div className="px-1.5 pb-1.5 text-[11px] font-semibold text-ink-dim">Toggle columns</div>
      {columns.map((c) => (
        <div
          key={c}
          onClick={() => onToggle(c)}
          className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-[11px] text-ink-dim hover:bg-card-hover hover:text-ink"
        >
          <Checkbox checked={!hidden.includes(c)} onChange={() => onToggle(c)} ariaLabel={`Toggle ${c}`} />
          <span className="truncate">{c}</span>
        </div>
      ))}
    </div>
  )
}
