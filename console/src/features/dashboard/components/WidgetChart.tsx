import { useMemo } from 'react'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import { widgetRowActions, type VariableValues, type Widget } from '../types'
import { toPieData, toSankeyData, toXYSeries, type QueryResult } from '../lib/queryData'
import { activeThreshold, aggregateMetric, formatMetric, metricOf, missingMetricColumn, thresholdCaption } from '../lib/metric'
import { thresholdLook } from '../lib/thresholds'
import { useChartPalette, MAX_SERIES } from '../lib/palette'
import XYChart from './charts/XYChart'
import PieDonut from './charts/PieDonut'
import SankeyChart from './charts/SankeyChart'
import { useMountAnimation } from './charts/chrome'
import TableWidget from './TableWidget'

// Renders one widget's query result as its chart form. Data-shape conventions
// live in lib/queryData.ts; colors come from the validated palette (assigned
// to series in fixed slot order, capped at MAX_SERIES — never cycled).

function MetricWidget({ widget, result, rate, values }: { widget: Widget; result: QueryResult; rate?: number | null; values?: VariableValues }) {
  const metric = metricOf(widget)
  const isRate = metric.aggregate === 'rate'
  const value = isRate ? rate ?? null : aggregateMetric(result, metric)
  const ready = useMountAnimation(result)
  const missing = missingMetricColumn(result, metric)
  if (missing) return <EmptyState>The result has no “{missing}” column.</EmptyState>
  // A rate shows "…" until its second sample lands; anything else with no value is empty.
  if (value === null && !isRate) return <EmptyState>Query returned no value.</EmptyState>
  const step = activeThreshold(value, metric)
  const look = thresholdLook(step.color)
  const caption = thresholdCaption(step, metric, values)
  const valueClass = look.textClass || 'text-foreground'
  const unit = widget.unit && <span className="ml-1.5 text-sm font-medium text-muted-foreground">{widget.unit}</span>

  if (metric.variant === 'tile') {
    return (
      <div className="flex h-full min-w-0 flex-col justify-center px-1" style={{ opacity: ready ? 1 : 0, transition: 'opacity 320ms ease' }}>
        <p className={`truncate text-[22px] font-bold leading-tight ${valueClass}`} style={look.textStyle}>
          {formatMetric(value, metric)}
          {widget.unit && <span className="ml-1 text-[12px] font-medium text-faint">{widget.unit}</span>}
        </p>
        {caption && (
          <p className="mt-1 truncate text-[11px] text-faint" title={caption}>
            {caption}
          </p>
        )}
      </div>
    )
  }

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
        <span className={`break-words text-[40px] font-bold leading-none ${valueClass}`} style={look.textStyle}>
          {formatMetric(value, metric)}
        </span>
        {unit}
        {caption && <p className="mt-2 truncate text-[11px] text-faint">{caption}</p>}
      </div>
    </div>
  )
}

export default function WidgetChart({
  widget,
  result,
  running,
  onRowAction,
  rate,
  values,
}: {
  widget: Widget
  result: QueryResult
  /** `metric` with the `rate` aggregate: the per-second change WidgetCard measured (null until two samples). */
  rate?: number | null
  /** Dashboard variable values, for `{{name}}` in a metric caption. */
  values?: VariableValues
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
      return (
        <TableWidget result={result} columns={widget.tableColumns} rowActions={widgetRowActions(widget)} running={running} onRowAction={onRowAction} />
      )
    case 'metric':
      return <MetricWidget widget={widget} result={result} rate={rate} values={values} />
    default:
      return <EmptyState>Unsupported widget type.</EmptyState>
  }
}
