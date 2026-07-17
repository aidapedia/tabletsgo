// Placeholder results used to preview a widget type before any query has run,
// so the type picker shows the actual diagram instead of an empty box. Each
// sample matches the real shape convention for its type (see queryData.ts), so
// what you see here is what a correctly-shaped query renders.

import type { WidgetType } from '../types'
import type { QueryResult } from './queryData'

const XY: QueryResult = {
  columns: ['day', 'delivered', 'failed'],
  rows: [
    { day: 'Mon', delivered: 120, failed: 8 },
    { day: 'Tue', delivered: 168, failed: 12 },
    { day: 'Wed', delivered: 142, failed: 6 },
    { day: 'Thu', delivered: 196, failed: 14 },
    { day: 'Fri', delivered: 224, failed: 9 },
    { day: 'Sat', delivered: 158, failed: 5 },
    { day: 'Sun', delivered: 132, failed: 7 },
  ],
}

const SAMPLES: Record<Exclude<WidgetType, 'text'>, QueryResult> = {
  area: XY,
  line: XY,
  bar: XY,
  pie: {
    columns: ['channel', 'total'],
    rows: [
      { channel: 'email', total: 420 },
      { channel: 'whatsapp', total: 580 },
      { channel: 'push', total: 190 },
    ],
  },
  table: {
    columns: ['id', 'title', 'channel', 'status'],
    rows: [
      { id: 165, title: 'E-Certificate', channel: 'email', status: 'delivered' },
      { id: 164, title: 'E-Certificate', channel: 'email', status: 'delivered' },
      { id: 163, title: 'E-Ticket', channel: 'whatsapp', status: 'pending' },
      { id: 160, title: 'E-Ticket', channel: 'email', status: 'failed' },
    ],
  },
  metric: { columns: ['total'], rows: [{ total: 1284 }] },
  sankey: {
    columns: ['source', 'target', 'value'],
    rows: [
      { source: 'queued', target: 'sent', value: 900 },
      { source: 'queued', target: 'dropped', value: 100 },
      { source: 'sent', target: 'delivered', value: 780 },
      { source: 'sent', target: 'failed', value: 120 },
    ],
  },
}

/** Sample result for a widget type — `text` has its own markdown preview. */
export function sampleResult(type: WidgetType): QueryResult | null {
  return type === 'text' ? null : SAMPLES[type]
}
