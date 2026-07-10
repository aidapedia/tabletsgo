import { useEffect, useMemo, useState } from 'react'
import DataGrid from '@/features/workspace/components/DataGrid'
import Button from '@/shared/ui/buttons/Button'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import Popover from '@/shared/ui/overlay/Popover'
import { FilterPanel, SortPanel, ColumnsPanel, matchFilter, PAGE_SIZES } from '@/features/workspace/components/TableView'
import {
  ChevronLeft,
  ChevronRight,
  ColumnsIcon,
  DownloadIcon,
  FilterIcon,
  RefreshIcon,
  SortIcon,
} from '@/shared/ui/icons'

const COLUMNS = ['Version', 'Status', 'Up SQL', 'Down SQL', 'Reversible', 'Executor', 'Committed at']

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

// Schema-version migration history for the active connection, opened from the
// version badge in the workspace header. Reuses the same DataGrid/toolbar
// pieces as the query-history tab (filter / sort / export / columns /
// pagination), plus a per-row Rollback action that runs the row's down SQL.
export default function SchemaHistoryView({ migrations = [], loading = false, onRefresh, onRollback }) {
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

  const allRows = useMemo(() => {
    // A row is a valid rollback target when it's still active and every active
    // version newer than it is reversible (the server undoes them all in one go;
    // the newest active version has nothing above it, so it can't be a target).
    const active = migrations.filter((m) => (m.status || 'active') === 'active')
    const canRollbackTo = (m) => {
      if ((m.status || 'active') !== 'active') return false
      const newer = active.filter((a) => a.version > m.version)
      return newer.length > 0 && newer.every((a) => a.reversible)
    }
    return migrations.map((m) => ({
      __id: m.id,
      __migration: m,
      __canRollback: canRollbackTo(m),
      Version: `v${m.version}`,
      Status: (m.status || 'active') === 'rollbacked' ? 'rolled back' : 'active',
      'Up SQL': m.forwardSql.join('\n'),
      'Down SQL': m.reversible ? m.rollbackSql.filter(Boolean).join('\n') : '—',
      Reversible: m.reversible ? 'yes' : 'no',
      Executor: m.executorName || '—',
      'Committed at': fmtTime(m.ts),
    }))
  }, [migrations])

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
    a.download = 'schema-history.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Toolbar — same shape as the query-history toolbar, minus bulk-select
          (schema migrations aren't deletable, only reversible via rollback). */}
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
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
                  <MenuItem
                    key={s}
                    onClick={() => {
                      setPageSize(s)
                      setPage(1)
                      close()
                    }}
                  >
                    {s} rows
                  </MenuItem>
                ))}
              </div>
            )}
          </Popover>

          <span className="pl-1 text-[11px] text-ink-faint">{total} rows</span>
        </div>
      </div>

      {loading ? (
        <div className="p-5 text-center text-xs text-ink-faint">Loading…</div>
      ) : migrations.length === 0 ? (
        <div className="p-[30px] text-center text-ink-faint">
          No schema changes committed yet — DDL commits show up here with their version.
        </div>
      ) : (
        <DataGrid
          columns={visibleColumns}
          rows={pageRows}
          getRowKey={(row) => row.__id}
          actionsLabel="Rollback"
          renderRowActions={(row) => {
            const m = row.__migration
            const isRolledBack = (m.status || 'active') === 'rollbacked'
            const title = isRolledBack
              ? 'Already rolled back.'
              : !row.__canRollback
                ? 'Current version — nothing newer to roll back.'
                : 'Roll the schema back to this version.'
            return (
              <Button
                variant="primary"
                size="sm"
                disabled={!row.__canRollback}
                title={title}
                onClick={() => onRollback?.(m)}
              >
                Rollback
              </Button>
            )
          }}
        />
      )}
    </div>
  )
}
