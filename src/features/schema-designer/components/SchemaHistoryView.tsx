import { useEffect, useMemo, useState } from 'react'
import DataGrid from '@/features/workspace/components/DataGrid'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import TextButton from '@/shared/ui/buttons/TextButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import Popover from '@/shared/ui/overlay/Popover'
import ContextMenu from '@/shared/ui/overlay/ContextMenu'
import SqlEditor from '@/shared/ui/SqlEditor'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { useToast } from '@/shared/ui/feedback/Toast'
import { FilterPanel, SortPanel, ColumnsPanel, matchFilter, PAGE_SIZES } from '@/features/workspace/components/TableView'
import {
  ChevronLeft,
  ChevronRight,
  ColumnsIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FilterIcon,
  HistoryIcon,
  RefreshIcon,
  SortIcon,
} from '@/shared/ui/icons'
import LoadingState from '@/shared/ui/feedback/LoadingState'

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

// Shared disabled-state explanation for the Rollback action (row button + context menu item).
const rollbackTitle = (row) => {
  if (row.__isBaseline) {
    return row.__canRollback
      ? 'Roll the schema all the way back to its initial state (undo every migration).'
      : 'Not every migration is reversible — can’t roll back to the initial state.'
  }
  const isRolledBack = (row.__migration.status || 'active') === 'rollbacked'
  return isRolledBack
    ? 'Already rolled back.'
    : !row.__canRollback
      ? 'Current version — nothing newer to roll back.'
      : 'Roll the schema back to this version.'
}

// Schema-version migration history for the active connection, opened from the
// version badge in the workspace header. Reuses the same DataGrid/toolbar
// pieces as the query-history tab (filter / sort / export / columns /
// pagination), plus a per-row Rollback action that runs the row's down SQL.
export default function SchemaHistoryView({ migrations = [], loading = false, dialect, onRefresh, onRollback }) {
  const [filters, setFilters] = useState([])
  const [sort, setSort] = useState(null) // { col, dir }
  const [hidden, setHidden] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [rowMenu, setRowMenu] = useState(null) // { x, y, migration, canRollback } — right-click menu
  const [inspecting, setInspecting] = useState(null) // migration shown in the inspector slide-over

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
    const rows = migrations.map((m) => ({
      __id: m.id,
      __migration: m,
      __isBaseline: false,
      __canRollback: canRollbackTo(m),
      Version: `v${m.version}`,
      Status: (m.status || 'active') === 'rollbacked' ? 'rolled back' : 'active',
      'Up SQL': m.forwardSql.join('\n'),
      'Down SQL': m.reversible ? m.rollbackSql.filter(Boolean).join('\n') : '—',
      Reversible: m.reversible ? 'yes' : 'no',
      Executor: m.executorName || '—',
      'Committed at': fmtTime(m.ts),
    }))

    // Synthetic baseline row: the initial state before the earliest active
    // migration. It has no migration record of its own (a fresh connection
    // starts at a version with nothing recorded), so without it the very first
    // DDL commit could never be rolled back. Rolling back to it undoes every
    // active migration; it only makes sense while at least one is active.
    if (active.length > 0) {
      const baselineVersion = Math.min(...active.map((a) => a.version)) - 1
      rows.push({
        __id: '__baseline__',
        __migration: {
          version: baselineVersion,
          status: 'active',
          reversible: true,
          forwardSql: [],
          rollbackSql: [],
        },
        __isBaseline: true,
        __canRollback: active.every((a) => a.reversible),
        Version: `v${baselineVersion}`,
        Status: 'initial',
        'Up SQL': '—',
        'Down SQL': '—',
        Reversible: '—',
        Executor: '—',
        'Committed at': '—',
      })
    }
    return rows
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
        <LoadingState className="p-5 text-center" />
      ) : migrations.length === 0 ? (
        <div className="p-[30px] text-center text-ink-faint">
          No schema changes committed yet — DDL commits show up here with their version.
        </div>
      ) : (
        <DataGrid
          columns={visibleColumns}
          rows={pageRows}
          getRowKey={(row) => row.__id}
          onCellContextMenu={(e, { row }) =>
            setRowMenu({
              x: e.clientX,
              y: e.clientY,
              migration: row.__migration,
              canRollback: row.__canRollback,
              isBaseline: row.__isBaseline,
            })
          }
          actionsLabel="Rollback"
          renderRowActions={(row) => (
            <Button
              variant="primary"
              size="sm"
              disabled={!row.__canRollback}
              title={rollbackTitle(row)}
              onClick={() => onRollback?.(row.__migration)}
            >
              {row.__isBaseline ? 'Restore initial' : 'Rollback'}
            </Button>
          )}
        />
      )}

      {rowMenu && (
        <ContextMenu x={rowMenu.x} y={rowMenu.y} onClose={() => setRowMenu(null)}>
          <MenuItem
            disabled={!rowMenu.canRollback}
            title={rollbackTitle({ __isBaseline: rowMenu.isBaseline, __canRollback: rowMenu.canRollback, __migration: rowMenu.migration })}
            onClick={() => {
              onRollback?.(rowMenu.migration)
              setRowMenu(null)
            }}
          >
            <HistoryIcon width={14} height={14} />{' '}
            {rowMenu.isBaseline ? 'Restore to initial state' : 'Roll back to this version'}
          </MenuItem>

          {!rowMenu.isBaseline && (
            <>
              <div className="my-1 h-px bg-edge" />

              <MenuItem
                onClick={() => {
                  setInspecting(rowMenu.migration)
                  setRowMenu(null)
                }}
              >
                <EyeIcon width={14} height={14} /> Open Inspector
              </MenuItem>
            </>
          )}
        </ContextMenu>
      )}

      {inspecting && (
        <MigrationInspector
          migration={inspecting}
          dialect={dialect}
          canRollback={allRows.find((r) => r.__id === inspecting.id)?.__canRollback}
          onClose={() => setInspecting(null)}
          onRollback={(m) => {
            setInspecting(null)
            onRollback?.(m)
          }}
        />
      )}
    </div>
  )
}

// Read-only detail view for a single migration — opened from the row context
// menu (or the Up/Down SQL cells, truncated in the grid). Offers the same
// Rollback action as the row button/menu, gated the same way.
function MigrationInspector({ migration, dialect, canRollback, onClose, onRollback }) {
  const { show, close } = useSlideOver(onClose)
  const toast = useToast()
  const isRolledBack = (migration.status || 'active') === 'rollbacked'

  const copySql = async (sql, label) => {
    try {
      await navigator.clipboard.writeText(sql)
      toast.success(label)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  const sqlHeader = (label, sql) => (
    <div className="mb-1.5 flex items-center justify-between">
      <span className="text-[11px] font-semibold tracking-wide text-ink-faint">{label}</span>
      <TextButton tone="faint" className="!text-[11px] hover:!text-ink" onClick={() => copySql(sql, `Copied ${label.toLowerCase()}`)}>
        <CopyIcon width={13} height={13} /> Copy
      </TextButton>
    </div>
  )

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end bg-black/50 transition-opacity duration-200 ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseDown={() => close()}
    >
      <div
        className={`flex h-full w-full max-w-[560px] flex-col border-l border-edge-strong bg-panel shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.8)] transition-transform duration-200 ease-out ${
          show ? 'translate-x-0' : 'translate-x-full'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <h3 className="flex items-center gap-2 text-base font-bold">
            Migration v{migration.version}
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${
                isRolledBack ? 'bg-ink-faint/15 text-ink-faint' : 'bg-green/15 text-green-bright'
              }`}
            >
              {isRolledBack ? 'rolled back' : 'active'}
            </span>
          </h3>
          <IconButton size="lg" onClick={() => close()} aria-label="Close">
            <ChevronRight />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-5 grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-faint">Executor</div>
              <div className="text-sm text-ink">{migration.executorName || '—'}</div>
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-faint">Committed at</div>
              <div className="text-sm text-ink">{fmtTime(migration.ts)}</div>
            </div>
          </div>

          <div className="mb-5">
            {sqlHeader('Up SQL', migration.forwardSql.join('\n'))}
            <SqlEditor value={migration.forwardSql.join('\n')} onChange={() => {}} dialect={dialect} editable={false} maxHeight="240px" />
          </div>

          <div>
            {migration.reversible ? (
              <>
                {sqlHeader('Down SQL', migration.rollbackSql.filter(Boolean).join('\n'))}
                <SqlEditor
                  value={migration.rollbackSql.filter(Boolean).join('\n')}
                  onChange={() => {}}
                  dialect={dialect}
                  editable={false}
                  maxHeight="240px"
                />
              </>
            ) : (
              <>
                <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-faint">Down SQL</div>
                <div className="rounded-soft border border-edge bg-bg px-3 py-2 text-[11px] text-ink-faint">
                  Not reversible — no down SQL was recorded for this commit.
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-edge px-5 py-4">
          <Button variant="subtle" onClick={() => close()}>
            Close
          </Button>
          <Button
            variant="primary"
            disabled={!canRollback}
            title={rollbackTitle({ __isBaseline: false, __canRollback: canRollback, __migration: migration })}
            onClick={() => close(() => onRollback(migration))}
          >
            Rollback to this version
          </Button>
        </div>
      </div>
    </div>
  )
}
