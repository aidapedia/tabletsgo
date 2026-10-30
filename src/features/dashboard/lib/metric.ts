// A `metric` widget's value: its result reduced by the chosen aggregate, and
// the threshold step (color + caption) that value falls in. `rate` needs two runs, so it is
// measured by WidgetCard from successive `sum`s (see sampleRate) and handed in.

import type { MetricThreshold, VariableValues, Widget, WidgetMetric } from '../types'
import { cellAt, firstRows, type QueryResult } from './queryData'
import { formatNumber, isTruthy, toNumber } from './format'
import { substituteVariables } from './variables'
import { activeStep } from './thresholds'

/** How often a `rate` metric re-reads its query to measure the change. */
export const RATE_SAMPLE_MS = 10_000

export function metricOf(widget: Widget): WidgetMetric {
  return widget.metric ?? {}
}

/** The reduced value — a number for every aggregate but `first`, which keeps the cell as is. */
export function aggregateMetric(result: QueryResult, metric: WidgetMetric): string | number | null {
  const { columns, rows } = firstRows(result)
  const agg = metric.aggregate === 'rate' ? 'sum' : metric.aggregate ?? 'first'
  if (agg === 'count' && !metric.column) return rows.length
  if (!columns.length) return null
  const idx = metric.column ? columns.indexOf(metric.column) : 0
  if (idx < 0) return null
  const cells = rows.map((r) => cellAt(r, columns, idx))

  if (agg === 'first') return cells.length && cells[0] !== undefined ? (cells[0] as any) : null
  if (agg === 'count') return cells.filter(isTruthy).length
  const nums = cells.map(toNumber).filter((n): n is number => n !== null)
  if (agg === 'sum') return nums.reduce((s, n) => s + n, 0)
  if (!nums.length) return null
  if (agg === 'min') return Math.min(...nums)
  if (agg === 'max') return Math.max(...nums)
  return nums.reduce((s, n) => s + n, 0) / nums.length
}

export type RateSample = { total: number; at: number }

/** Per-second change between the previous sample and this one; null until there are two. */
export function sampleRate(prev: RateSample | null, next: RateSample): number | null {
  if (!prev || next.at <= prev.at) return null
  return Math.max(0, (next.total - prev.total) / ((next.at - prev.at) / 1000))
}

export function formatMetric(value: string | number | null, metric: WidgetMetric): string {
  if (value === null) return '…'
  // A rate reads as "0.4", never "0" — one decimal unless the widget says otherwise.
  const decimals = metric.decimals ?? (metric.aggregate === 'rate' && Math.abs(Number(value)) < 10 ? 1 : undefined)
  return formatNumber(value, metric.format, decimals)
}

/** The threshold step a metric's value falls in — the base (or none) below every step. */
export function activeThreshold(value: string | number | null, metric: WidgetMetric): MetricThreshold {
  return activeStep(value, metric.thresholds) ?? {}
}

/** The line under the value: the active step's caption, or else that of the nearest step below it with one. */
export function thresholdCaption(step: MetricThreshold, metric: WidgetMetric, values: VariableValues = {}): string {
  const reached = (metric.thresholds ?? []).filter((t) => t.from === undefined || (step.from !== undefined && t.from <= step.from))
  const ordered = [...reached].sort((a, b) => (a.from ?? -Infinity) - (b.from ?? -Infinity))
  const caption = step.caption || ordered.reverse().find((t) => t.caption)?.caption || ''
  return substituteVariables(caption, values)
}
