// Table data export / import against /connections/:id/data/* — see
// server/data-transfer.js. These move files rather than JSON, so they use
// fetch directly (like the backup download/upload) instead of request().
import { API_URL } from '@/shared/config'
import { getToken } from '@/shared/api/request'

export type DataFormat = 'csv' | 'json' | 'sql'

export const DATA_FORMATS: { value: DataFormat; label: string }[] = [
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
  { value: 'sql', label: 'SQL' },
]

export const PREVIEW_ROWS = 50

export type ImportTable = {
  table: string
  columns: string[]
  total: number
  rows: any[]
  exists: boolean
  /** Only on a table the import creates: where its schema comes from, and that schema. */
  schemaFrom?: 'file' | 'inferred'
  ddl?: string[]
  types?: Record<string, string> | null
}

export type ImportPreview =
  | { format: DataFormat; kind: 'script'; statements: number; sample: string }
  | { format: DataFormat; kind: 'rows'; tables: ImportTable[] }

export type ImportResult =
  | { format: DataFormat; kind: 'script'; statements: number }
  | { format: DataFormat; kind: 'rows'; created: string[]; tables: { table: string; inserted: number }[] }

// Query string for a connection call, with its selected namespace.
function query(conn: any, params: Record<string, string | number | boolean | null | undefined>) {
  const p = new URLSearchParams()
  if (conn?.ns?.database) p.set('database', conn.ns.database)
  if (conn?.ns?.schema) p.set('schema', conn.ns.schema)
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== false && v !== '') p.set(k, v === true ? '1' : String(v))
  }
  return p.toString()
}

async function call(path: string, init: RequestInit = {}) {
  const token = getToken()
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || `Request failed (${res.status})`)
  }
  return res
}

type ExportOptions = { tables: string[]; format: DataFormat; includeSchema?: boolean; limit?: number }

const exportPath = (conn: any, { tables, format, includeSchema, limit }: ExportOptions) =>
  `/connections/${conn.id}/data/export?${query(conn, { tables: tables.join(','), format, includeSchema, limit })}`

/** The export file as text — the panel's preview, with `limit` rows per table. */
export async function fetchExportText(conn: any, opts: ExportOptions): Promise<string> {
  return (await call(exportPath(conn, opts))).text()
}

/**
 * Download an export. A CSV file holds one table, so a CSV export of several
 * tables saves one file per table.
 */
export async function downloadExport(conn: any, opts: ExportOptions) {
  const files = opts.format === 'csv' ? opts.tables.map((t) => ({ ...opts, tables: [t] })) : [opts]
  for (const file of files) {
    const res = await call(exportPath(conn, file))
    const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') || '')?.[1] || `export.${opts.format}`
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }
}

// The server reads everything it needs from the file and its name: the format,
// the table(s) the rows go into, and the schema of any table it has to create.
async function postImport(conn: any, file: File, dryRun: boolean) {
  const qs = query(conn, { filename: file.name, dryRun })
  const res = await call(`/connections/${conn.id}/data/import?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: file,
  })
  return res.json()
}

/** What importing `file` would do — nothing is written. */
export const previewImport = (conn: any, file: File): Promise<ImportPreview> => postImport(conn, file, true)

export const runImport = (conn: any, file: File): Promise<ImportResult> => postImport(conn, file, false)
