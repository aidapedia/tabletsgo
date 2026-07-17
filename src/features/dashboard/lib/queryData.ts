// Normalizes `/query` results (rows arrive as objects or arrays depending on
// dialect) and reshapes them for each widget type. Conventions, kept simple
// and database-agnostic:
//   area/line/bar — first column is the x axis, every other numeric column is a series
//   pie           — first column is the slice label, second is the value
//   metric        — the first cell of the first row
//   sankey        — three columns: source, target, value (one link per row)

export type QueryResult = { columns?: string[]; rows?: any[]; error?: string }

export function firstRows(result: QueryResult): { columns: string[]; rows: any[] } {
  return { columns: result?.columns || [], rows: result?.rows || [] }
}

export function cellAt(row: any, columns: string[], idx: number) {
  return Array.isArray(row) ? row[idx] : row?.[columns[idx]]
}

const toNumber = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export type XYDatum = Record<string, string | number | null>
export type XYSeries = { data: XYDatum[]; xKey: string; seriesKeys: string[] }

/** area/line/bar: x = first column, series = every remaining numeric column. */
export function toXYSeries(result: QueryResult): XYSeries {
  const { columns, rows } = firstRows(result)
  if (columns.length < 2) return { data: [], xKey: '', seriesKeys: [] }
  const xKey = columns[0]
  // A column is a series if at least one row has a numeric value for it.
  const seriesKeys = columns.slice(1).filter((_, i) => rows.some((r) => toNumber(cellAt(r, columns, i + 1)) !== null))
  const data = rows.map((row) => {
    const d: XYDatum = { [xKey]: String(cellAt(row, columns, 0) ?? '') }
    columns.slice(1).forEach((col, i) => {
      d[col] = toNumber(cellAt(row, columns, i + 1))
    })
    return d
  })
  return { data, xKey, seriesKeys }
}

export type PieDatum = { name: string; value: number }

export function toPieData(result: QueryResult): PieDatum[] {
  const { columns, rows } = firstRows(result)
  if (columns.length < 2) return []
  return rows
    .map((row) => ({
      name: String(cellAt(row, columns, 0) ?? ''),
      value: toNumber(cellAt(row, columns, 1)) ?? 0,
    }))
    .filter((d) => d.value > 0)
}

export function toMetric(result: QueryResult): string | number | null {
  const { columns, rows } = firstRows(result)
  if (!rows.length || !columns.length) return null
  const v = cellAt(rows[0], columns, 0)
  return v === undefined ? null : v
}

export type SankeyData = { nodes: { name: string }[]; links: { source: number; target: number; value: number }[] }

export function toSankeyData(result: QueryResult): SankeyData {
  const { columns, rows } = firstRows(result)
  if (columns.length < 3) return { nodes: [], links: [] }
  const index = new Map<string, number>()
  const nodes: { name: string }[] = []
  const nodeIndex = (name: string) => {
    if (!index.has(name)) {
      index.set(name, nodes.length)
      nodes.push({ name })
    }
    return index.get(name)!
  }
  const links: SankeyData['links'] = []
  for (const row of rows) {
    const source = String(cellAt(row, columns, 0) ?? '')
    const target = String(cellAt(row, columns, 1) ?? '')
    const value = toNumber(cellAt(row, columns, 2))
    if (!source || !target || source === target || value === null || value <= 0) continue
    links.push({ source: nodeIndex(source), target: nodeIndex(target), value })
  }
  return { nodes, links }
}
