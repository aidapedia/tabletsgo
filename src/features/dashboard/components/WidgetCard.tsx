import { useEffect, useMemo, useState } from 'react'
import { runQuery } from '@/shared/api/database'
import { runWorkflow } from '@/features/workflow'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import { useToast } from '@/shared/ui/feedback/Toast'
import IconButton from '@/shared/ui/buttons/IconButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import Popover from '@/shared/ui/overlay/Popover'
import { ChevronLeft, ChevronRight, CopyIcon, EditIcon, MoreVerticalIcon, TrashIcon } from '@/shared/ui/icons'
import { widgetRowActions, type Widget, type VariableValues } from '../types'
import { referencedVariables, substituteVariables, isVariableSet } from '../lib/variables'
import type { QueryResult } from '../lib/queryData'
import WidgetChart from './WidgetChart'
import MarkdownText from './MarkdownText'

// One dashboard tile: header (drag handle + actions) and the widget body.
// Owns running its own query — re-runs when the substituted SQL changes
// (variable selection) or when the dashboard-level refreshKey bumps.
export default function WidgetCard({
  conn,
  widget,
  values,
  refreshKey = 0,
  editable = true,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  conn: any
  widget: Widget
  values: VariableValues
  refreshKey?: number
  editable?: boolean
  onEdit?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
}) {
  // {{name}} placeholders the query references that don't have a selected
  // value yet — run the query once every one of them does, not before (an
  // unresolved placeholder would just fail as bad SQL).
  const missingVars = useMemo(
    () => referencedVariables(widget.query).filter((name) => !isVariableSet(values[name])),
    [widget.query, values]
  )

  const baseSql = useMemo(
    () => (widget.type === 'text' || !widget.query || missingVars.length > 0 ? '' : substituteVariables(widget.query, values)),
    [widget.type, widget.query, values, missingVars.length]
  )

  // Server-side pagination for table widgets: wrap the query in LIMIT/OFFSET
  // (valid on every roadmap dialect) and fetch pageSize+1 rows — the extra row
  // only signals that a next page exists, without a costly COUNT(*).
  const pageSize = widget.type === 'table' && widget.pageSize ? widget.pageSize : 0
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [baseSql, pageSize])

  const sql = useMemo(() => {
    if (!baseSql.trim() || !pageSize) return baseSql
    return `SELECT * FROM (${baseSql.replace(/;+\s*$/, '')}) AS _page LIMIT ${pageSize + 1} OFFSET ${page * pageSize}`
  }, [baseSql, pageSize, page])

  const [result, setResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  // Bumped after a successful row-action run so the widget re-queries (the
  // workflow likely changed the rows it displays).
  const [actionRefresh, setActionRefresh] = useState(0)

  useEffect(() => {
    if (!sql.trim()) {
      setResult(null)
      return
    }
    let alive = true
    setLoading(true)
    runQuery(conn, sql).then((r: QueryResult) => {
      if (!alive) return
      setResult(r)
      setLoading(false)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql, refreshKey, actionRefresh, conn?.id, conn?.ns?.database, conn?.ns?.schema])

  // Trim the has-more probe row before rendering.
  const hasMore = !!pageSize && (result?.rows?.length ?? 0) > pageSize
  const display = useMemo(
    () => (result && hasMore ? { ...result, rows: result.rows!.slice(0, pageSize) } : result),
    [result, hasMore, pageSize]
  )

  const toast = useToast()
  const [running, setRunning] = useState<{ row: number; action: number } | null>(null)

  const runRowAction = async (row: Record<string, unknown>, rowIndex: number, actionIndex: number) => {
    const action = widgetRowActions(widget)[actionIndex]
    if (!action || running !== null) return
    const name = action.workflowName || 'Workflow'
    setRunning({ row: rowIndex, action: actionIndex })
    try {
      const res = await runWorkflow(conn.id, action.workflowId, undefined, row, 'dashboard')
      if (res.ok) {
        toast.success(`${name} finished.`)
        setActionRefresh((n) => n + 1)
      } else {
        toast.error(`${name} failed: ${res.error}`)
      }
    } catch (e: any) {
      // 404 here usually means the workflow was deleted (or the dashboard was imported from elsewhere).
      toast.error(`Couldn't run ${name}: ${e.message}`)
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-card border border-edge bg-card">
      <div
        className={`flex shrink-0 items-center gap-2 px-3 pt-2.5 ${editable ? 'widget-drag-handle cursor-grab active:cursor-grabbing' : ''}`}
      >
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink-dim">{widget.title}</span>
        {editable && (
          <Popover
            align="right"
            width={170}
            trigger={({ open, toggle }) => (
              <IconButton size="sm" active={open} onClick={toggle} aria-label="Widget actions">
                <MoreVerticalIcon width={14} height={14} />
              </IconButton>
            )}
          >
            {({ close }) => (
              // Stop the grid from treating menu interaction as a drag start.
              <div className="p-1" onPointerDown={(e) => e.stopPropagation()}>
                <MenuItem onClick={() => { onEdit?.(); close() }}>
                  <EditIcon width={14} height={14} /> Edit
                </MenuItem>
                <MenuItem onClick={() => { onDuplicate?.(); close() }}>
                  <CopyIcon width={14} height={14} /> Duplicate
                </MenuItem>
                <div className="my-1 h-px bg-edge" />
                <MenuItem danger onClick={() => { onDelete?.(); close() }}>
                  <TrashIcon width={14} height={14} /> Delete
                </MenuItem>
              </div>
            )}
          </Popover>
        )}
      </div>

      <div className="min-h-0 flex-1 p-2.5 pt-1.5">
        {widget.type === 'text' ? (
          <div className="h-full overflow-y-auto px-1">
            <MarkdownText text={widget.text} />
          </div>
        ) : !widget.query?.trim() ? (
          <EmptyState>No query yet — edit this widget to add one.</EmptyState>
        ) : missingVars.length > 0 ? (
          <EmptyState>Pick a value for {missingVars.map((v) => `{{${v}}}`).join(', ')} in Filters to run this widget.</EmptyState>
        ) : loading && !result ? (
          <LoadingState className="py-6 text-center" />
        ) : display?.error ? (
          <div className="overflow-y-auto whitespace-pre-wrap break-words px-1 py-2 text-[11px] text-red">{display.error}</div>
        ) : display ? (
          <div className={`flex h-full flex-col ${loading ? 'opacity-60 transition-opacity' : ''}`}>
            <div className="min-h-0 flex-1">
              <WidgetChart widget={widget} result={display} running={running} onRowAction={runRowAction} />
            </div>
            {pageSize > 0 && (
              <div className="flex shrink-0 items-center justify-end gap-1 pt-1.5">
                <span className="mr-1 text-[11px] tabular-nums text-ink-faint">Page {page + 1}</span>
                <IconButton size="sm" className="disabled:opacity-40" aria-label="Previous page" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  <ChevronLeft width={14} height={14} />
                </IconButton>
                <IconButton size="sm" className="disabled:opacity-40" aria-label="Next page" disabled={!hasMore || loading} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight width={14} height={14} />
                </IconButton>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
