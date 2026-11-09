import { useMemo } from 'react'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import { ROW_ACTION_BUTTON, rowActionState, type ColumnDisplay, type WidgetColumn, type WidgetRowAction } from '../types'
import { rowActionIcon } from '../lib/rowActionIcons'
import { firstRows, cellAt, type QueryResult } from '../lib/queryData'
import { formatNumber, toList, toNumber } from '../lib/format'
import { activeStep, thresholdLook } from '../lib/thresholds'
import { useMountAnimation } from './charts/chrome'
import { Button } from '@/shared/ui/button'

// A `table` widget. Without `columns` every query column shows as returned;
// with them, exactly those show, in that order, each drawn by its display.

const RIGHT_ALIGNED: ColumnDisplay[] = ['number', 'compact', 'bytes']

const Null = () => <span className="text-faint">null</span>

function Cell({ col, row, columns, max }: { col: WidgetColumn; row: any; columns: string[]; max: number }) {
  const at = (name: string) => {
    const j = columns.indexOf(name)
    return j < 0 ? undefined : cellAt(row, columns, j)
  }
  const v = at(col.column)
  const display = col.display ?? 'text'
  const affix = (text: string) => `${col.prefix ?? ''}${text}${col.unit ?? ''}`
  // The step colors the cell by the value it shows — a count by its count.
  const look = thresholdLook(activeStep(display === 'count' ? toList(v).length : v, col.thresholds)?.color)
  const tinted = (content: string) => (
    <span className={look.textClass} style={look.textStyle}>
      {content}
    </span>
  )

  switch (display) {
    case 'number':
    case 'compact':
    case 'bytes':
      return v === null || v === undefined ? <Null /> : tinted(affix(formatNumber(v, display, col.decimals)))
    case 'bar': {
      const n = toNumber(v) ?? 0
      const pct = max > 0 ? Math.max(n > 0 ? 2 : 0, Math.round((n / max) * 100)) : 0
      return (
        <div className="h-1.5 min-w-[80px] overflow-hidden rounded-full bg-muted" title={affix(formatNumber(v, 'number', col.decimals))}>
          <div className={`h-full rounded-full ${look.fillClass || 'bg-primary'}`} style={{ width: `${pct}%`, ...look.fillStyle }} />
        </div>
      )
    }
    case 'badges': {
      const items = toList(v)
      const marked = col.ref ? new Set(toList(at(col.ref))) : null
      if (!items.length) return <span className="text-faint">—</span>
      return (
        <div className="flex flex-wrap gap-1">
          {items.map((item, i) => {
            const on = !marked || marked.has(item)
            return (
              <span
                key={`${item}-${i}`}
                title={marked ? `${item} — ${on ? 'also' : 'not'} in ${col.ref}` : undefined}
                className={`flex h-5 min-w-5 items-center justify-center rounded-[5px] px-1 text-[10px] font-semibold ${
                  !marked
                    ? 'border border-border bg-muted text-muted-foreground'
                    : on
                      ? 'border border-primary/40 bg-primary/15 text-primary-bright'
                      : 'border border-dashed border-warning text-warning'
                }`}
              >
                {affix(item)}
              </span>
            )
          })}
        </div>
      )
    }
    case 'count': {
      const n = toList(v).length
      if (!col.ref) return tinted(affix(String(n)))
      const of = toList(at(col.ref)).length
      // Thresholds, when they color it, win over the built-in "short is amber".
      if (look.tinted) return tinted(affix(`${n} / ${of}`))
      return <span className={n < of ? 'font-semibold text-warning' : ''}>{affix(`${n} / ${of}`)}</span>
    }
    default:
      return v === null || v === undefined ? <Null /> : tinted(affix(String(v)))
  }
}

export default function TableWidget({
  result,
  columns: shown,
  rowActions,
  running,
  onRowAction,
}: {
  result: QueryResult
  columns?: WidgetColumn[]
  rowActions?: WidgetRowAction[]
  running?: { row: number; action: number } | null
  onRowAction?: (row: Record<string, unknown>, rowIndex: number, actionIndex: number) => void
}) {
  const { columns, rows } = firstRows(result)
  const ready = useMountAnimation(result)
  const cols: WidgetColumn[] = useMemo(() => shown?.length ? shown : columns.map((column) => ({ column })), [shown, columns])
  // A bar is a share of the largest value in its column, on the rows shown.
  const maxes = useMemo(
    () =>
      cols.map((c) => {
        if (c.display !== 'bar') return 0
        const j = columns.indexOf(c.column)
        return j < 0 ? 0 : Math.max(0, ...rows.map((r) => toNumber(cellAt(r, columns, j)) ?? 0))
      }),
    [cols, columns, rows]
  )
  if (!columns.length) return <EmptyState>Query returned no rows.</EmptyState>
  // Normalize a row (array or object depending on dialect) into a stable
  // column→value object — the shape the workflow receives as its input.
  const rowObject = (row: any): Record<string, unknown> =>
    Object.fromEntries(columns.map((c, j) => [c, cellAt(row, columns, j)]))
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-left text-[11px]">
        <thead className="sticky top-0 z-[1] bg-card">
          <tr>
            {cols.map((c, k) => (
              <th
                key={k}
                className={`border-b border-border px-2.5 py-1.5 font-semibold text-muted-foreground ${RIGHT_ALIGNED.includes(c.display!) ? 'text-right' : ''}`}
              >
                {c.label || c.column}
              </th>
            ))}
            {!!rowActions?.length && <th className="w-px border-b border-border px-2.5 py-1.5" aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="hover:bg-accent"
              style={{
                opacity: ready ? 1 : 0,
                transition: `opacity 260ms ease ${Math.min(i, 20) * 20}ms`,
              }}
            >
              {cols.map((c, k) => (
                <td
                  key={k}
                  className={`max-w-[280px] truncate border-b border-border/60 px-2.5 py-1.5 text-foreground tabular-nums ${
                    RIGHT_ALIGNED.includes(c.display!) ? 'text-right' : ''
                  } ${c.mono ? 'font-mono' : ''}`}
                >
                  <Cell col={c} row={row} columns={columns} max={maxes[k]} />
                </td>
              ))}
              {!!rowActions?.length && (() => {
                // One row object drives both the condition checks and the workflow payload.
                const ro = rowObject(row)
                return (
                  <td className="border-b border-border/60 px-2.5 py-1">
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      {rowActions.map((action, a) => {
                        const { hidden, disabled } = rowActionState(action, ro)
                        if (hidden) return null
                        const isRunning = running?.row === i && running?.action === a
                        const ActionIcon = rowActionIcon(action.icon)
                        return (
                          <Button
                            key={a}
                            size="sm"
                            variant={ROW_ACTION_BUTTON[action.variant ?? 'ghost']}
                            className="!rounded-[6px] !py-0.5"
                            disabled={!onRowAction || running != null || disabled}
                            onClick={() => onRowAction?.(ro, i, a)}
                          >
                            {!isRunning && <ActionIcon width={15} height={15} />}
                            {isRunning ? 'Running…' : action.label?.trim() || 'Run'}
                          </Button>
                        )
                      })}
                    </div>
                  </td>
                )
              })()}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
