import { useEffect, useMemo, useState } from 'react'
import Badge from '@/shared/ui/Badge'
import SearchInput from '@/shared/ui/form/SearchInput'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import { RowAction, RowActions } from '@/shared/ui/table/RowActions'
import useDataTable from '@/shared/ui/table/useDataTable'
import { DatabaseIcon, ExternalLinkIcon, WorkflowIcon } from '@/shared/ui/icons'
import { relativeTime } from '@/shared/lib/recents'
import { listWorkspaceWorkflows, type WorkspaceWorkflow } from '../lib/api'

/**
 * Every workflow in the workspace, in one table.
 *
 * A workflow belongs to a connection — the console's rail is where you build
 * one. What that rail can't answer is the workspace-wide question ("what is
 * scheduled here, and did any of it fail?"), because it only ever shows the one
 * connection you have open. So this list spans them: the connection is a column
 * rather than the context, and a row opens the workflow in its own console.
 *
 * Read-only on purpose. Editing a graph needs the builder, and duplicating
 * rename/delete here would mean two places to keep in step with the panel that
 * owns them.
 */
export default function WorkspaceWorkflowList({
  workspaceId,
  onOpen,
}: {
  workspaceId: string
  onOpen: (workflow: WorkspaceWorkflow) => void
}) {
  const [rows, setRows] = useState<WorkspaceWorkflow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    listWorkspaceWorkflows(workspaceId).then((list) => {
      if (!alive) return
      setRows(list)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [workspaceId])

  // Name and connection both — with the connection as a column, "which
  // workflows touch the analytics DB?" is a search, not a scroll.
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.connectionName.toLowerCase().includes(q))
  }, [rows, filter])

  const columns: Column<WorkspaceWorkflow>[] = [
    {
      key: 'name',
      header: 'Workflow',
      sortable: true,
      render: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-elevated">
            <WorkflowIcon width={14} height={14} className="text-ink-dim" />
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
      key: 'scheduleEnabled',
      header: 'Schedule',
      sortable: true,
      width: 150,
      render: (row) =>
        row.scheduleEnabled ? (
          <span className="flex flex-col gap-0.5">
            <Badge tone="green">On</Badge>
            {row.nextRunAt && <span className="text-[10px] text-ink-faint">Next {new Date(row.nextRunAt).toLocaleString()}</span>}
          </span>
        ) : (
          <Badge tone="faint">Manual</Badge>
        ),
    },
    {
      key: 'lastRun',
      header: 'Last run',
      sortable: true,
      width: 160,
      // Never-run sorts last in both directions (nulls last), which is what you
      // want either way round: the question is always about the ones that ran.
      sortValue: (row) => row.lastRun?.at ?? null,
      render: (row) =>
        row.lastRun ? (
          <span className="flex flex-col gap-0.5">
            <Badge tone={row.lastRun.status === 'success' ? 'green' : 'red'}>{row.lastRun.status}</Badge>
            <span className="text-[10px] text-ink-faint">{relativeTime(row.lastRun.at)}</span>
          </span>
        ) : (
          <span className="text-[11px] text-ink-faint">Never run</span>
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
      {/* Same bare search row as the other list views (MembersPanel, the
          connections list): full-width flexing input, mb-4 to the table. The
          row count lives in the table's own pagination footer. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-[220px] flex-1"
          value={filter}
          onChange={(e: any) => setFilter(e.target.value)}
          placeholder="Search workflows or connections…"
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
              ? 'No workflows yet — build one from a connection’s Workflows panel.'
              : 'No workflow matches that search.'}
          </EmptyState>
        }
        {...table}
      />
    </div>
  )
}
