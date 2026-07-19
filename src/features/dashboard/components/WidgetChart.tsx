import { useMemo } from 'react'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import Button from '@/shared/ui/buttons/Button'
import { rowActionState, widgetRowActions, type Widget, type WidgetRowAction } from '../types'
import { rowActionIcon } from '../lib/rowActionIcons'
import { toMetric, toPieData, toSankeyData, toXYSeries, firstRows, cellAt, type QueryResult } from '../lib/queryData'
import { useChartPalette, MAX_SERIES } from '../lib/palette'
import XYChart from './charts/XYChart'
import PieDonut from './charts/PieDonut'
import SankeyChart from './charts/SankeyChart'
import { fmtNum, useMountAnimation } from './charts/chrome'

// Renders one widget's query result as its chart form. Data-shape conventions
// live in lib/queryData.ts; colors come from the validated palette (assigned
// to series in fixed slot order, capped at MAX_SERIES — never cycled).

function TableWidget({
  result,
  rowActions,
  running,
  onRowAction,
}: {
  result: QueryResult
  rowActions?: WidgetRowAction[]
  running?: { row: number; action: number } | null
  onRowAction?: (row: Record<string, unknown>, rowIndex: number, actionIndex: number) => void
}) {
  const { columns, rows } = firstRows(result)
  const ready = useMountAnimation(result)
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
            {columns.map((c) => (
              <th key={c} className="border-b border-edge px-2.5 py-1.5 font-semibold text-ink-dim">
                {c}
              </th>
            ))}
            {!!rowActions?.length && <th className="w-px border-b border-edge px-2.5 py-1.5" aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="hover:bg-card-hover"
              style={{
                opacity: ready ? 1 : 0,
                transition: `opacity 260ms ease ${Math.min(i, 20) * 20}ms`,
              }}
            >
              {columns.map((c, j) => {
                const v = cellAt(row, columns, j)
                return (
                  <td key={c} className="max-w-[280px] truncate border-b border-edge/60 px-2.5 py-1.5 text-ink tabular-nums">
                    {v === null || v === undefined ? <span className="text-ink-faint">null</span> : String(v)}
                  </td>
                )
              })}
              {!!rowActions?.length && (() => {
                // One row object drives both the condition checks and the workflow payload.
                const ro = rowObject(row)
                return (
                  <td className="border-b border-edge/60 px-2.5 py-1">
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      {rowActions.map((action, a) => {
                        const { hidden, disabled } = rowActionState(action, ro)
                        if (hidden) return null
                        const isRunning = running?.row === i && running?.action === a
                        return (
                          <Button
                            key={a}
                            size="sm"
                            variant={action.variant ?? 'ghost'}
                            icon={isRunning ? undefined : rowActionIcon(action.icon)}
                            className="!rounded-[6px] !py-0.5"
                            disabled={!onRowAction || running != null || disabled}
                            onClick={() => onRowAction?.(ro, i, a)}
                          >
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

function MetricWidget({ result, unit }: { result: QueryResult; unit?: string }) {
  const value = toMetric(result)
  const ready = useMountAnimation(result)
  if (value === null) return <EmptyState>Query returned no value.</EmptyState>
  return (
    <div className="flex h-full items-center justify-center">
      <div
        className="min-w-0 px-2 text-center"
        style={{
          opacity: ready ? 1 : 0,
          transform: ready ? 'scale(1)' : 'scale(0.9)',
          transition: 'opacity 320ms ease, transform 320ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <span className="break-words text-[40px] font-bold leading-none text-ink">{fmtNum(value)}</span>
        {unit && <span className="ml-1.5 text-sm font-medium text-ink-dim">{unit}</span>}
      </div>
    </div>
  )
}

export default function WidgetChart({
  widget,
  result,
  running,
  onRowAction,
}: {
  widget: Widget
  result: QueryResult
  /** table row-action state/handler — owned by WidgetCard; absent in previews (buttons render disabled). */
  running?: { row: number; action: number } | null
  onRowAction?: (row: Record<string, unknown>, rowIndex: number, actionIndex: number) => void
}) {
  const base = useChartPalette()
  // Per-widget color overrides replace individual palette slots; unset slots keep the theme default.
  const palette = useMemo(
    () => (widget.colors?.length ? { ...base, series: base.series.map((c, i) => widget.colors?.[i] || c) } : base),
    [base, widget.colors]
  )

  const xy = useMemo(
    () => (widget.type === 'area' || widget.type === 'line' || widget.type === 'bar' ? toXYSeries(result) : null),
    [widget.type, result]
  )
  const pie = useMemo(() => {
    if (widget.type !== 'pie') return null
    const all = toPieData(result)
    if (all.length <= MAX_SERIES) return all
    // Fold everything past the first MAX_SERIES-1 slices into "Other".
    const kept = all.slice(0, MAX_SERIES - 1)
    const other = all.slice(MAX_SERIES - 1).reduce((sum, d) => sum + d.value, 0)
    return [...kept, { name: 'Other', value: other }]
  }, [widget.type, result])
  const sankey = useMemo(() => (widget.type === 'sankey' ? toSankeyData(result) : null), [widget.type, result])

  switch (widget.type) {
    case 'area':
    case 'line':
    case 'bar': {
      if (!xy!.data.length || !xy!.seriesKeys.length) {
        return <EmptyState>Query returned no plottable data — need a label column plus one numeric column.</EmptyState>
      }
      const capped = { ...xy!, seriesKeys: xy!.seriesKeys.slice(0, MAX_SERIES) }
      return <XYChart kind={widget.type} series={capped} palette={palette} />
    }
    case 'pie':
      if (!pie!.length) return <EmptyState>Query returned no data — need a label column plus a numeric column.</EmptyState>
      return <PieDonut data={pie!} palette={palette} />
    case 'sankey':
      if (!sankey!.links.length) {
        return <EmptyState>Query returned no flows — need three columns: source, target, value.</EmptyState>
      }
      return <SankeyChart data={sankey!} palette={palette} />
    case 'table':
      return <TableWidget result={result} rowActions={widgetRowActions(widget)} running={running} onRowAction={onRowAction} />
    case 'metric':
      return <MetricWidget result={result} unit={widget.unit} />
    default:
      return <EmptyState>Unsupported widget type.</EmptyState>
  }
}
