import { useEffect, useMemo, useState } from 'react'
import Badge from '@/shared/ui/Badge'
import SearchInput from '@/shared/ui/form/SearchInput'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import { RowAction, RowActions } from '@/shared/ui/table/RowActions'
import useDataTable from '@/shared/ui/table/useDataTable'
import { DatabaseIcon, DiagramIcon, ExternalLinkIcon } from '@/shared/ui/icons'
import { relativeTime } from '@/shared/lib/recents'
import { listWorkspaceSchemas } from '../lib/api'
import type { WorkspaceSchemaDraft } from '../types'

/**
 * Every schema draft in the workspace, in one table.
 *
 * A draft belongs to a connection — the console's Schema rail is where you
 * design one. What that rail can't answer is the workspace-wide question
 * ("what schema work is in flight, and against which database?"), because it
 * only ever shows the one connection you have open. So this list spans them:
 * the connection is a column rather than the context, and a row opens the
 * draft in the schema editor page.
 *
 * Read-only on purpose, same as WorkspaceDashboardList: editing a draft needs
 * the diagram, and duplicating rename/delete here would mean two places to keep
 * in step with the panel that owns them.
 */
export default function WorkspaceSchemaList({
  workspaceId,
  onOpen,
}: {
  workspaceId: string
  onOpen: (draft: WorkspaceSchemaDraft) => void
}) {
  const [rows, setRows] = useState<WorkspaceSchemaDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    listWorkspaceSchemas(workspaceId).then((list) => {
      if (!alive) return
      setRows(list)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [workspaceId])

  // Name and target both — with the target as a column, "what is staged against
  // the analytics DB?" is a search, not a scroll. A from-scratch draft has no
  // connection name, so its dialect is what the search has to match on.
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.connectionName || r.connectionType || '').toLowerCase().includes(q)
    )
  }, [rows, filter])

  const columns: Column<WorkspaceSchemaDraft>[] = [
    {
      key: 'name',
      header: 'Draft',
      sortable: true,
      render: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-elevated">
            <DiagramIcon width={14} height={14} className="text-ink-dim" />
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
      header: 'Target',
      sortable: true,
      width: 200,
      // A draft either targets a connection (named) or a bare dialect (from
      // scratch) — the column says which, so the two kinds read apart without a
      // second column that is blank half the time.
      render: (row) =>
        row.connectionId ? (
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-dim">
            <DatabaseIcon width={12} height={12} className="shrink-0 text-ink-faint" />
            <span className="truncate">{row.connectionName}</span>
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5">
            <Badge tone="faint">From scratch</Badge>
            <span className="truncate text-[11px] text-ink-faint">{row.connectionType}</span>
          </span>
        ),
    },
    {
      key: 'statementCount',
      header: 'Changes',
      sortable: true,
      width: 140,
      render: (row) =>
        row.statementCount ? (
          <Badge tone="green">
            {row.statementCount} statement{row.statementCount === 1 ? '' : 's'}
          </Badge>
        ) : (
          <Badge tone="faint">Empty</Badge>
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
            label="Open in the schema editor"
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
      {/* Same bare search row as the other list views (WorkspaceDashboardList,
          WorkspaceWorkflowList, the connections list): full-width flexing input,
          mb-4 to the table. The row count lives in the table's pagination footer. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-[220px] flex-1"
          value={filter}
          onChange={(e: any) => setFilter(e.target.value)}
          placeholder="Search drafts or connections…"
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
              ? 'No schema drafts yet — start one with New schema.'
              : 'No draft matches that search.'}
          </EmptyState>
        }
        {...table}
      />
    </div>
  )
}
