import { useEffect, useRef, useState, type ReactNode } from 'react'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import Badge from '@/shared/ui/Badge'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CodeIcon, TableIcon, UploadIcon } from '@/shared/ui/icons'
import TransferLayout, { PreviewMessage, SectionHeader, ToolbarDivider } from './TransferLayout'
import { PREVIEW_ROWS, previewImport, runImport, type ImportPreview, type ImportResult, type ImportTable } from '../lib/dataTransfer'

const fmtSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const cell = (v: any) => (v === null || v === undefined ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v))

const summarize = (r: ImportResult) => {
  if (r.kind === 'script') return `Ran ${plural(r.statements, 'statement')}.`
  const rows = r.tables.reduce((n, t) => n + t.inserted, 0)
  const created = r.created.length ? ` Created ${r.created.join(', ')}.` : ''
  return `Imported ${plural(rows, 'row')} into ${plural(r.tables.length, 'table')}.${created}`
}

const TableStatus = ({ t }: { t: ImportTable }) =>
  t.exists ? <Badge tone="neutral">existing</Badge> : <Badge tone="green">new table</Badge>

/**
 * Import mode: drop a file and that's all. The server reads it without writing
 * anything (a dry run) and says what the Import button will do — the format,
 * which tables the rows go into (a CSV or a plain JSON array goes into the
 * table named after the file), and the schema of any table it will create,
 * taken from the file itself or inferred from the rows.
 */
export default function DataImportPane({
  conn,
  switcher,
  onImported,
}: {
  conn: any
  switcher: ReactNode
  onImported: () => void
}) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<{ data?: ImportPreview; error?: string; loading?: boolean }>({})
  const [importing, setImporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const latest = useRef(0)

  useEffect(() => {
    if (!file) {
      setPreview({})
      return
    }
    const id = ++latest.current
    setPreview({ loading: true })
    previewImport(conn, file)
      .then((data) => id === latest.current && setPreview({ data }))
      .catch((error) => id === latest.current && setPreview({ error: error.message }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, conn.id, conn.ns?.database, conn.ns?.schema])

  const doImport = async () => {
    if (!file) return
    setImporting(true)
    try {
      toast.success(summarize(await runImport(conn, file)))
      setFile(null)
      onImported()
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setImporting(false)
    }
  }

  const data = preview.data

  return (
    <TransferLayout
      toolbar={
        <>
          {switcher}
          <ToolbarDivider />
          <Button variant="primary" icon={UploadIcon} onClick={doImport} disabled={!data || importing}>
            {importing ? 'Importing…' : 'Import'}
          </Button>
          <span className="text-[11px] text-ink-faint">CSV, JSON or SQL — the file says where its data goes</span>
        </>
      }
      side={
        <>
          <SectionHeader>
            <span>Source file</span>
            {file && (
              <TextButton className="!text-xs" onClick={() => setFile(null)}>
                Clear
              </TextButton>
            )}
          </SectionHeader>
          <div className="border-b border-edge p-4">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.json,.sql,text/csv,application/json,application/sql,text/plain"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0])
              }}
              className={`flex w-full flex-col items-center gap-1.5 rounded-soft border border-dashed px-3 py-6 text-center text-xs transition-colors ${
                dragging ? 'border-green bg-green/5 text-ink' : 'border-edge-strong text-ink-dim hover:border-ink-faint hover:text-ink'
              }`}
            >
              <UploadIcon width={18} height={18} className="text-ink-faint" />
              {file ? (
                <>
                  <span className="max-w-full truncate font-semibold text-ink">{file.name}</span>
                  <span className="text-[11px] text-ink-faint">
                    {fmtSize(file.size)}
                    {data ? ` · ${data.format.toUpperCase()}` : ''} · click to replace
                  </span>
                </>
              ) : (
                <span>Drop a .csv, .json or .sql file, or click to choose</span>
              )}
            </button>
          </div>
          {data && (
            <>
              <SectionHeader>
                <span>What it will do</span>
              </SectionHeader>
              <div className="min-h-0 flex-1 overflow-y-auto py-1">
                {data.kind === 'script' ? (
                  <div className="flex items-center gap-3 px-4 py-2 text-xs text-ink">
                    <CodeIcon width={15} height={15} className="shrink-0 text-ink-faint" />
                    Run {plural(data.statements, 'statement')} in one transaction
                  </div>
                ) : (
                  data.tables.map((t) => (
                    <div key={t.table} className="flex items-center gap-3 px-4 py-2 text-xs text-ink">
                      <TableIcon width={15} height={15} className="shrink-0 text-ink-faint" />
                      <span className="min-w-0 flex-1 truncate">{t.table}</span>
                      <span className="shrink-0 text-ink-faint">{plural(t.total, 'row')}</span>
                      <TableStatus t={t} />
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </>
      }
      previewTitle={
        <>
          <span>Preview (first {PREVIEW_ROWS} rows per table)</span>
          {preview.loading && <span className="text-ink-faint">Reading…</span>}
        </>
      }
      preview={
        !file ? (
          <PreviewMessage>Choose a file to preview</PreviewMessage>
        ) : preview.error ? (
          <PreviewMessage tone="error">{preview.error}</PreviewMessage>
        ) : !data ? null : data.kind === 'script' ? (
          <pre className="whitespace-pre p-4 font-mono text-[11px] leading-5 text-ink-dim">{data.sample}</pre>
        ) : (
          <div className="flex flex-col gap-6 p-4">
            {data.tables.map((t) => (
              <section key={t.table} className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <TableIcon width={14} height={14} className="text-ink-faint" />
                  <span className="font-semibold text-ink">{t.table}</span>
                  <span className="text-ink-faint">{plural(t.total, 'row')}</span>
                  <TableStatus t={t} />
                </div>
                {!t.exists && t.ddl && (
                  <div>
                    <div className="mb-1 text-[11px] text-ink-faint">
                      {t.schemaFrom === 'file' ? 'Created from the schema in the file:' : 'Created with column types inferred from the rows:'}
                    </div>
                    <pre className="whitespace-pre rounded-soft border border-edge bg-elevated/40 p-3 font-mono text-[11px] leading-5 text-ink-dim">
                      {t.ddl.join('\n')}
                    </pre>
                  </div>
                )}
                <PreviewTable columns={t.columns} rows={t.rows} />
              </section>
            ))}
          </div>
        )
      }
    />
  )
}

function PreviewTable({ columns, rows }: { columns: string[]; rows: any[] }) {
  if (!rows.length) return <div className="text-[11px] text-ink-faint">No rows.</div>
  return (
    <div className="overflow-x-auto rounded-soft border border-edge">
      <table className="w-full border-collapse font-mono text-[11px]">
        <thead>
          <tr className="bg-elevated text-left text-ink-dim">
            {columns.map((c) => (
              <th key={c} className="whitespace-nowrap border-b border-edge px-3 py-1.5 font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-edge last:border-b-0">
              {columns.map((c) => (
                <td
                  key={c}
                  className={`max-w-[280px] truncate whitespace-nowrap px-3 py-1.5 ${r[c] == null ? 'text-ink-faint' : 'text-ink'}`}
                >
                  {cell(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
