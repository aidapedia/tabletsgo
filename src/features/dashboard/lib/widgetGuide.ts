// Per-widget-type authoring guide: what shape the query must return, and a
// runnable example. This is the single source of truth for the shape rules —
// the renderers in lib/queryData.ts implement exactly these conventions, and
// the widget editor surfaces them (column roles + "Use this example").
//
// Examples are written in dialect-neutral SQL (plain GROUP BY / CASE) so they
// run on SQLite and PostgreSQL alike.

import type { WidgetType } from '../types'

export type ShapeColumn = { label: string; role: string }
export type WidgetGuide = {
  /** One-liner, also shown under the sample preview. */
  hint: string
  columns: ShapeColumn[]
  /** Example query — offered as "Use this example" in the editor. */
  example: string
}

const XY_GUIDE = (kind: string): WidgetGuide => ({
  hint: 'First column = x axis, every other numeric column = a series.',
  columns: [
    { label: 'Column 1', role: 'X axis label (e.g. a day, a channel)' },
    { label: 'Column 2+', role: 'One numeric series each — up to 8' },
  ],
  example: `-- One row per x value; each extra numeric column is a ${kind}
SELECT created_date AS day,
       COUNT(CASE WHEN status = 'delivered' THEN 1 END) AS delivered,
       COUNT(CASE WHEN status = 'failed' THEN 1 END)    AS failed
FROM notifications
GROUP BY created_date
ORDER BY created_date`,
})

export const WIDGET_GUIDE: Record<WidgetType, WidgetGuide> = {
  area: XY_GUIDE('band'),
  line: XY_GUIDE('line'),
  bar: XY_GUIDE('bar'),
  pie: {
    hint: 'Two columns: slice label, then a numeric value.',
    columns: [
      { label: 'Column 1', role: 'Slice label' },
      { label: 'Column 2', role: 'Slice value (numeric, greater than 0)' },
    ],
    example: `-- One row per slice; slices past the 8th fold into "Other"
SELECT channel, COUNT(*) AS total
FROM notifications
GROUP BY channel`,
  },
  table: {
    hint: 'Every column and row is rendered as returned.',
    columns: [{ label: 'Any columns', role: 'Shown in order, as returned' }],
    example: `-- Keep the row count modest; the widget scrolls
SELECT id, title, channel, status
FROM notifications
ORDER BY id DESC
LIMIT 50`,
  },
  metric: {
    hint: 'The first cell of the first row is shown; other cells are ignored.',
    columns: [{ label: 'Row 1, column 1', role: 'The number shown (set a unit in the Format tab)' }],
    example: `-- A single aggregate value
SELECT COUNT(*) AS total
FROM notifications
WHERE status = 'delivered'`,
  },
  sankey: {
    hint: 'Three columns: source, target, value — one flow per row.',
    columns: [
      { label: 'Column 1', role: 'Source node name' },
      { label: 'Column 2', role: 'Target node name' },
      { label: 'Column 3', role: 'Flow value (numeric, greater than 0)' },
    ],
    example: `-- One row per source → target flow (self-flows are skipped)
SELECT from_status AS source, to_status AS target, COUNT(*) AS value
FROM status_transitions
GROUP BY from_status, to_status`,
  },
  text: {
    hint: 'No query — this widget renders the markdown you type.',
    columns: [{ label: 'No query', role: 'Markdown: # headings, **bold**, `code`, - lists, [links](url)' }],
    example: '',
  },
}

/**
 * A query built from the connection's own tables/columns, in the shape this
 * widget type needs — unlike WIDGET_GUIDE's example, which references
 * table/column names that don't exist in the user's schema. Picks the
 * richest table (most columns) as a reasonable default; null when there's no
 * schema yet or the table doesn't have enough columns for this shape.
 */
export function recommendQuery(type: WidgetType, schema: Record<string, string[]> = {}): string | null {
  const tables = Object.keys(schema)
  if (!tables.length || type === 'text') return null
  const table = tables.reduce((best, t) => (schema[t].length > (schema[best]?.length ?? 0) ? t : best), tables[0])
  const cols = schema[table] || []

  switch (type) {
    case 'metric':
      return `SELECT COUNT(*) AS total\nFROM ${table}`
    case 'table':
      return `SELECT *\nFROM ${table}\nLIMIT 50`
    case 'pie':
      if (!cols.length) return null
      return `SELECT ${cols[0]}, COUNT(*) AS total\nFROM ${table}\nGROUP BY ${cols[0]}`
    case 'sankey':
      if (cols.length < 2) return null
      return `SELECT ${cols[0]} AS source, ${cols[1]} AS target, COUNT(*) AS value\nFROM ${table}\nGROUP BY ${cols[0]}, ${cols[1]}`
    case 'area':
    case 'line':
    case 'bar':
      if (!cols.length) return null
      return `SELECT ${cols[0]},\n       COUNT(*) AS total\nFROM ${table}\nGROUP BY ${cols[0]}\nORDER BY ${cols[0]}`
    default:
      return null
  }
}
