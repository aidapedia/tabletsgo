import { useEffect, useMemo, useState } from 'react'
import { runQuery } from '@/shared/api/database'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import IconButton from '@/shared/ui/buttons/IconButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import Popover from '@/shared/ui/overlay/Popover'
import { CopyIcon, EditIcon, MoreVerticalIcon, TrashIcon } from '@/shared/ui/icons'
import type { Widget } from '../types'
import { referencedVariables, substituteVariables } from '../lib/variables'
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
  values: Record<string, string>
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
    () => referencedVariables(widget.query).filter((name) => !values[name]),
    [widget.query, values]
  )

  const sql = useMemo(
    () => (widget.type === 'text' || !widget.query || missingVars.length > 0 ? '' : substituteVariables(widget.query, values)),
    [widget.type, widget.query, values, missingVars.length]
  )

  const [result, setResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(false)

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
  }, [sql, refreshKey, conn?.id, conn?.ns?.database, conn?.ns?.schema])

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
        ) : result?.error ? (
          <div className="overflow-y-auto whitespace-pre-wrap break-words px-1 py-2 text-[11px] text-red">{result.error}</div>
        ) : result ? (
          <div className={`h-full ${loading ? 'opacity-60 transition-opacity' : ''}`}>
            <WidgetChart widget={widget} result={result} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
