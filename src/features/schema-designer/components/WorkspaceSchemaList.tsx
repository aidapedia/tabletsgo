import { useEffect, useMemo, useState } from 'react'
import Avatar from '@/shared/ui/Avatar'
import Badge from '@/shared/ui/Badge'
import SearchInput from '@/shared/ui/form/SearchInput'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import { RowAction, RowActions } from '@/shared/ui/table/RowActions'
import useDataTable from '@/shared/ui/table/useDataTable'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import {
  DatabaseIcon,
  DbLogo,
  DiagramIcon,
  ExternalLinkIcon,
  HistoryIcon,
  TrashIcon,
  UnlinkIcon,
} from '@/shared/ui/icons'
import { TYPE_LABEL } from '@/features/connections'
import { relativeTime } from '@/shared/lib/recents'
import { deleteWorkspaceSchema, listWorkspaceSchemas } from '../lib/api'
import type { WorkspaceSchemaDraft } from '../types'

// The person who started a draft: the initial bubble the rest of the app uses,
// their name, and the date. An id with no name behind it (deleted account, or a
// draft older than the audit trail) is drawn as unknown rather than as an empty
// cell, so a blank never reads as "nobody started this".
function AuthorCell({ name, when }: { name: string | null; when: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {name ? <Avatar label={name} size="sm" /> : <span className="h-6 w-6 shrink-0 rounded-full bg-elevated" />}
      <span className="min-w-0">
        <span className={`block truncate text-[11px] ${name ? 'text-ink-dim' : 'text-ink-faint italic'}`}>
          {name || 'Unknown'}
        </span>
        <span className="block truncate text-[10px] text-ink-faint">{when}</span>
      </span>
    </span>
  )
}

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
 * Editing a draft needs the diagram, so the row never tries to be an editor —
 * but the three things you can decide *about* a draft without opening it are
 * here, because a list is where you compare drafts and a list of thirty is
 * where the dead one is spotted. Only delete happens here: it is a list
 * mutation (the row goes away, and the list is what knows that), and it is the
 * same two routes `linkToConnection` branches between, so it lives in the
 * client the list already reads through. Unlink and version history *navigate*
 * — one to the editor with its dialog open, one to the connection's console —
 * so they are the page's to route, and this component only says which draft.
 * Duplicating the unlink move itself here would mean two implementations of a
 * carry-the-tables-out flow that needs a canvas to be honest.
 *
 * It does answer *whose*, though: a schema is shared work, so who started a
 * design is a column here rather than something you open the editor to find out.
 * Who saved it *last* is not — that is the editor's header, next to the design
 * it describes; here it would be a second name per row saying almost always the
 * same thing as the first. The time of that last save still shows, under the
 * name. The names come resolved from the server (see `withAudit` in server.js) —
 * the list never looks a user up itself.
 */
export default function WorkspaceSchemaList({
  workspaceId,
  onOpen,
  onUnlink,
  onShowHistory,
}: {
  workspaceId: string
  onOpen: (draft: WorkspaceSchemaDraft) => void
  /** Cut a draft loose from its connection — the editor page owns the move. */
  onUnlink?: (draft: WorkspaceSchemaDraft) => void
  /** The target connection's migration trail, which lives in its console. */
  onShowHistory?: (draft: WorkspaceSchemaDraft) => void
}) {
  const toast = useToast()
  const [rows, setRows] = useState<WorkspaceSchemaDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  // The draft the delete confirmation is about, and whether its request is in
  // flight — a draft is shared work, so deleting one always asks first.
  const [confirming, setConfirming] = useState<WorkspaceSchemaDraft | null>(null)
  const [deleting, setDeleting] = useState(false)

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

  // Name, target, engine and author — with the target as a column, "what is
  // staged against the analytics DB?" is a search, not a scroll, and with the
  // author in it so is "what has Dana been designing?". The engine matches on
  // both spellings (`postgresql` and "PostgreSQL"), so typing what the row
  // *shows* finds it and so does typing what the row stores.
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.connectionName || '').toLowerCase().includes(q) ||
        (r.connectionType || '').toLowerCase().includes(q) ||
        (TYPE_LABEL[r.connectionType] || '').toLowerCase().includes(q) ||
        (r.createdByName || '').toLowerCase().includes(q)
    )
  }, [rows, filter])

  /**
   * Drop the confirmed draft and take its row out of the table.
   *
   * The row is removed from state rather than the list refetched: the request
   * that just succeeded is the whole news, and a refetch would repaint every
   * row (and lose the reader's page) to learn the one thing already known.
   *
   * Nothing else is touched. A linked draft's connection keeps its tables, its
   * schema version and its migration history — a draft is DDL that has not run,
   * so deleting one un-stages work and destroys no data. That is exactly why
   * this needs no typed confirmation, only a dialog naming what is going.
   */
  const confirmDelete = async () => {
    const target = confirming
    if (!target || deleting) return
    setDeleting(true)
    try {
      await deleteWorkspaceSchema(workspaceId, target)
      setRows((list) => list.filter((r) => r.id !== target.id))
      setConfirming(null)
      toast.success(`Deleted “${target.name}”.`)
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not delete the schema draft')
    } finally {
      setDeleting(false)
    }
  }

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
      // The connection a draft is staged against — and a dash when there isn't
      // one. A from-scratch draft has no target *by definition*, so the honest
      // cell is the same empty marker the rest of the tables use rather than a
      // badge that dresses "nothing" up as a value; the engine it targets is its
      // own column now, filled for both kinds.
      //
      // The version rides with the name rather than taking a column of its own:
      // it is a fact about *that* connection (v3 means nothing without knowing
      // which database), and a column would be blank on every from-scratch row
      // for a number three characters wide. Same `v{n}` the console's status bar
      // shows, so the two read as the same counter.
      sortValue: (row) => row.connectionName || '',
      render: (row) =>
        row.connectionId ? (
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-dim">
            <DatabaseIcon width={12} height={12} className="shrink-0 text-ink-faint" />
            <span className="truncate">{row.connectionName}</span>
            <span className="shrink-0" title={`Schema version of ${row.connectionName}`}>
              <Badge tone="neutral">v{row.connectionSchemaVersion ?? 1}</Badge>
            </span>
          </span>
        ) : (
          <span className="text-[11px] text-ink-faint" title="From scratch — not staged against a connection">
            —
          </span>
        ),
    },
    {
      key: 'connectionType',
      header: 'Database type',
      sortable: true,
      width: 160,
      // The dialect the DDL is written in: the connection's engine for a staged
      // draft, the chosen one for a from-scratch draft. Same logo + label pair
      // the connections list uses, so an engine looks the same wherever it is
      // named.
      sortValue: (row) => TYPE_LABEL[row.connectionType] || row.connectionType || '',
      render: (row) => (
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-dim">
          <DbLogo type={row.connectionType} className="h-4 w-4 shrink-0 rounded-[5px]" />
          <span className="truncate">{TYPE_LABEL[row.connectionType] || row.connectionType}</span>
        </span>
      ),
    },
    {
      key: 'createdByName',
      header: 'Created by',
      sortable: true,
      width: 170,
      className: 'max-[900px]:hidden',
      sortValue: (row) => row.createdByName || '',
      render: (row) => <AuthorCell name={row.createdByName} when={new Date(row.createdAt).toLocaleDateString()} />,
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
      width: 160,
      align: 'right' as const,
      // Four actions, and two of them only mean something with a database
      // behind the draft — so a from-scratch row keeps them disabled with the
      // reason rather than dropping them, which is what stops the column
      // reshuffling from row to row (see RowAction).
      render: (row) => (
        <RowActions>
          <RowAction
            icon={ExternalLinkIcon}
            label="Open in the schema editor"
            aria={`Open ${row.name}`}
            onClick={() => onOpen(row)}
          />
          <RowAction
            icon={HistoryIcon}
            label={`Schema version history of ${row.connectionName}`}
            aria={`Show the schema version history behind ${row.name}`}
            disabled={!row.connectionId}
            disabledHint="From scratch — no database behind it, so nothing has been committed to have a history"
            onClick={() => onShowHistory?.(row)}
          />
          <RowAction
            icon={UnlinkIcon}
            label="Unlink from its connection"
            aria={`Unlink ${row.name} from its connection`}
            disabled={!row.connectionId}
            disabledHint="Already a from-scratch design — there is no connection to unlink from"
            onClick={() => onUnlink?.(row)}
          />
          <RowAction
            icon={TrashIcon}
            tone="danger"
            label="Delete draft"
            aria={`Delete ${row.name}`}
            onClick={() => setConfirming(row)}
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

      {/* Naming the draft and its target is the whole safeguard: no database
          changes here, so what is at risk is the design itself. */}
      {confirming && (
        <ConfirmDialog
          title={`Delete “${confirming.name}”?`}
          message={
            confirming.connectionId
              ? `Its ${confirming.statementCount || 0} staged statement${
                  confirming.statementCount === 1 ? '' : 's'
                } and its diagram are removed. ${confirming.connectionName} keeps its tables, its schema version and its history — nothing here has been released to it.`
              : 'Its staged statements and its diagram are removed. This design was never linked to a database, so nothing else changes.'
          }
          confirmLabel={deleting ? 'Deleting…' : 'Delete draft'}
          danger
          onConfirm={confirmDelete}
          onCancel={() => !deleting && setConfirming(null)}
        />
      )}
    </div>
  )
}
