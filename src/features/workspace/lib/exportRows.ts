// Row export helpers shared by the grid toolbars. Each formatter takes the
// visible columns + the rows already filtered/sorted by the caller, so what you
// see in the grid is what lands in the file.

// Quote a JS value for inline SQL (dev tool — table is trusted, values escaped).
export const sqlValue = (v) => {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return `'${String(v).replace(/'/g, "''")}'`
}

const csvCell = (v) => {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const toCsv = (columns, rows) =>
  [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n')

export const toJson = (columns, rows) =>
  JSON.stringify(
    rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null]))),
    null,
    2
  )

export const toSql = (columns, rows, table) => {
  const cols = columns.map((c) => `"${c}"`).join(', ')
  return rows
    .map((r) => `INSERT INTO "${table}" (${cols}) VALUES (${columns.map((c) => sqlValue(r[c])).join(', ')});`)
    .join('\n')
}

export const EXPORT_FORMATS = [
  { id: 'csv', label: 'CSV', ext: 'csv', mime: 'text/csv;charset=utf-8;' },
  { id: 'json', label: 'JSON', ext: 'json', mime: 'application/json;charset=utf-8;' },
  { id: 'sql', label: 'SQL insert', ext: 'sql', mime: 'application/sql;charset=utf-8;' },
]

// Serialize + save. `table` names the file and the INSERT target for SQL.
export function downloadRows(format, { columns, rows, table }) {
  const spec = EXPORT_FORMATS.find((f) => f.id === format) || EXPORT_FORMATS[0]
  const text =
    spec.id === 'json' ? toJson(columns, rows) : spec.id === 'sql' ? toSql(columns, rows, table) : toCsv(columns, rows)
  const url = URL.createObjectURL(new Blob([text], { type: spec.mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${table}.${spec.ext}`
  a.click()
  URL.revokeObjectURL(url)
}
