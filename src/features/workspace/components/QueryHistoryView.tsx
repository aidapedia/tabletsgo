import { useEffect, useMemo, useState } from 'react'
import DataGrid from '@/features/workspace/components/DataGrid'
import Button from '@/shared/ui/Button'
import Popover from '@/shared/ui/Popover'
import {
  FilterPanel,
  SortPanel,
  ColumnsPanel,
  matchFilter,
  PAGE_SIZES,
  gridMenuItem,
} from '@/features/workspace/components/TableView'
import {
  ChevronLeft,
  ChevronRight,
  CloseIcon,
  ColumnsIcon,
  DownloadIcon,
  FilterIcon,
  RefreshIcon,
  SortIcon,
  TrashIcon,
} from '@/shared/ui/icons'

const COLUMNS = ['Status', 'Query', 'Table', 'Latency', 'Executed at', 'Executor', 'Error']

const fmtTime = (ts) => {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// Past query executions for the active connection. Reuses the table tab's
// DataGrid and toolbar pieces (filter / sort / export / columns / pagination),
// with selectable rows and a delete action for the selection.
export default function QueryHistoryView({ history = [], loading = false, onRefresh, onClear, onDelete }) {
  const [selected, setSelected] = useState(() => new Set()) // selected history ids
  const [filters, setFilters] = useState([])
  const [sort, setSort] = useState(null) // { col, dir }
  const [hidden, setHidden] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  // Load (or reload) when the tab is opened.
  useEffect(() => {
    onRefresh?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Display rows carry a hidden __id (used as the grid row key) so selection
  // survives filtering / sorting / pagination.
  const allRows = useMemo(
    () =>
      history.map((h) => ({
        __id: h.id,
        Status: h.status === 'failed' ? 'failed' : 'success',
        Query: h.query,
        Table: h.table || '—',
        Latency: h.latency != null ? `${h.latency} ms` : '—',
        'Executed at': fmtTime(h.executedAt),
        Executor: h.executorName || '—',
        Error: h.error || '',
      })),
    [history]
  )

  // Drop selections for rows that no longer exist after a refresh/clear/delete.
  useEffect(() => {
    setSelected((s) => {
      const ids = new Set(history.map((h) => h.id))
      const next = new Set([...s].filter((id) => ids.has(id)))
      return next.size === s.size ? s : next
    })
  }, [history])

  const filtered = useMemo(() => allRows.filter((r) => filters.every((f) => matchFilter(r, f))), [allRows, filters])

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

  const visibleColumns = useMemo(() => COLUMNS.filter((c) => !hidden.includes(c)), [hidden])

  const total = sorted.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  useEffect(() => setPage((p) => Math.min(Math.max(1, p), pageCount)), [pageCount])
  const pageRows = useMemo(() => sorted.slice((page - 1) * pageSize, page * pageSize), [sorted, page, pageSize])

  const activeFilterCount = filters.filter((f) => f.enabled && f.col && f.value !== '').length

  const toggleColumn = (c) => setHidden((h) => (h.includes(c) ? h.filter((x) => x !== c) : [...h, c]))

  // ---- Selection ----
  const rowKey = (row) => row.__id
  const toggleRow = (row) =>
    setSelected((s) => {
      const n = new Set(s)
      n.has(row.__id) ? n.delete(row.__id) : n.add(row.__id)
      return n
    })
  const toggleAll = () =>
    setSelected((s) => {
      const allOnPage = pageRows.length > 0 && pageRows.every((r) => s.has(r.__id))
      const n = new Set(s)
      pageRows.forEach((r) => (allOnPage ? n.delete(r.__id) : n.add(r.__id)))
      return n
    })
  const clearSelection = () => setSelected(new Set())
  const selCount = selected.size

  const deleteSelected = () => {
    if (!selCount) return
    onDelete?.([...selected])
    clearSelection()
  }

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
    a.download = 'query-history.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Toolbar — left actions swap to bulk delete when rows are selected; the
          right cluster (columns / pagination / page size) stays visible. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        {selCount > 0 ? (
          <>
            <Button
              variant="primary"
              size="sm"
              icon={TrashIcon}
              onClick={deleteSelected}
              className="!bg-red !text-white hover:!bg-red/90"
            >
              Delete
            </Button>

            <div className="mx-0.5 h-5 w-px bg-edge" />

            <span className="text-[11px] font-semibold text-ink">{selCount} selected</span>

            <Button variant="subtle" size="sm" className="!px-2" onClick={clearSelection} aria-label="Clear selection">
              <CloseIcon width={16} height={16} />
            </Button>
          </>
        ) : (
          <>
            <Button variant="subtle" size="sm" icon={RefreshIcon} onClick={onRefresh} disabled={loading}>
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
                  columns={COLUMNS}
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
                  columns={COLUMNS}
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
            <ColumnsPanel columns={COLUMNS} hidden={hidden} onToggle={toggleColumn} />
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
                    className={gridMenuItem}
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
        <div className="p-5 text-center text-xs text-ink-faint">Loading…</div>
      ) : history.length === 0 ? (
        <div className="p-[30px] text-center text-ink-faint">No query history yet. Run a query to see it here.</div>
      ) : (
        <DataGrid
          columns={visibleColumns}
          rows={pageRows}
          selectable
          getRowKey={rowKey}
          selectedKeys={selected}
          onToggleRow={toggleRow}
          onToggleAll={toggleAll}
        />
      )}
    </div>
  )
}
