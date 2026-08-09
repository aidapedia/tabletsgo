import { useEffect, useMemo, useState } from 'react'
import Badge from '@/shared/ui/Badge'
import SearchInput from '@/shared/ui/form/SearchInput'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import { RowAction, RowActions } from '@/shared/ui/table/RowActions'
import useDataTable from '@/shared/ui/table/useDataTable'
import { DatabaseIcon, ExternalLinkIcon, GridIcon } from '@/shared/ui/icons'
import { relativeTime } from '@/shared/lib/recents'
import { listWorkspaceDashboards } from '../lib/api'
import type { WorkspaceDashboard } from '../types'

/**
 * Every dashboard in the workspace, in one table.
 *
 * A dashboard belongs to a connection — the console's rail is where you build
 * one. What that rail can't answer is the workspace-wide question ("what have we
 * built, and where does it live?"), because it only ever shows the one
 * connection you have open. So this list spans them: the connection is a column
 * rather than the context, and a row opens the dashboard in its own console.
 *
 * Read-only on purpose, same as WorkspaceWorkflowList: editing a dashboard needs
 * the widget grid, and duplicating rename/delete here would mean two places to
 * keep in step with the panel that owns them.
 */
export default function WorkspaceDashboardList({
  workspaceId,
  onOpen,
}: {
  workspaceId: string
  onOpen: (dashboard: WorkspaceDashboard) => void
}) {
  const [rows, setRows] = useState<WorkspaceDashboard[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    listWorkspaceDashboards(workspaceId).then((list) => {
      if (!alive) return
      setRows(list)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [workspaceId])

  // Name and connection both — with the connection as a column, "which
  // dashboards read the analytics DB?" is a search, not a scroll.
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.connectionName.toLowerCase().includes(q))
  }, [rows, filter])

  const columns: Column<WorkspaceDashboard>[] = [
    {
      key: 'name',
      header: 'Dashboard',
      sortable: true,
      render: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-elevated">
            <GridIcon width={14} height={14} className="text-ink-dim" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-medium text-ink">{row.name}</span>
            <span className="block text-[10px] text-ink-faint">Updated {relativeTime(row.ts)}</span>
          </span>
        </div>
      ),
    },
    {
      key: 'connectionName',
      header: 'Connection',
      sortable: true,
      width: 200,
      render: (row) => (
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-dim">
          <DatabaseIcon width={12} height={12} className="shrink-0 text-ink-faint" />
          <span className="truncate">{row.connectionName}</span>
        </span>
      ),
    },
    {
      key: 'widgetCount',
      header: 'Widgets',
      sortable: true,
      width: 120,
      render: (row) =>
        row.widgetCount ? (
          <Badge tone="green">
            {row.widgetCount} widget{row.widgetCount === 1 ? '' : 's'}
          </Badge>
        ) : (
          <Badge tone="faint">Empty</Badge>
        ),
    },
    {
      key: 'variableCount',
      header: 'Variables',
      sortable: true,
      width: 120,
      render: (row) =>
        row.variableCount ? (
          <span className="text-[11px] text-ink-dim tabular-nums">{row.variableCount}</span>
        ) : (
          <span className="text-[11px] text-ink-faint">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      width: 70,
      align: 'right' as const,
      render: (row) => (
        <RowActions>
          <RowAction
            icon={ExternalLinkIcon}
            label="Open in its connection"
            aria={`Open ${row.name}`}
            onClick={() => onOpen(row)}
          />
        </RowActions>
      ),
    },
  ]

  const table = useDataTable({ rows: filtered, columns, pageSize: 10, resetKey: filter })

  return (
    <div>
      {/* Same bare search row as the other list views (WorkspaceWorkflowList,
          MembersPanel, the connections list): full-width flexing input, mb-4 to
          the table. The row count lives in the table's own pagination footer. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-[220px] flex-1"
          value={filter}
          onChange={(e: any) => setFilter(e.target.value)}
          placeholder="Search dashboards or connections…"
        />
      </div>

      <DataTable
        columns={columns}
        rowKey={(row) => row.id}
        onRowClick={onOpen}
        loading={loading}
        empty={
          <EmptyState>
            {rows.length === 0
              ? 'No dashboards yet — build one from a connection’s Dashboards panel.'
              : 'No dashboard matches that search.'}
          </EmptyState>
        }
        {...table}
      />
    </div>
  )
}
