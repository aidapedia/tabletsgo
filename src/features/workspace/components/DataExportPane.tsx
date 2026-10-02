import { useEffect, useRef, useState, type ReactNode } from 'react'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import Segmented from '@/shared/ui/form/Segmented'
import { useToast } from '@/shared/ui/feedback/Toast'
import { DownloadIcon, TableIcon } from '@/shared/ui/icons'
import { toggleId } from '@/shared/lib/toggleId'
import TransferLayout, { PreviewMessage, SectionHeader, TableRow, ToolbarCheck, ToolbarDivider } from './TransferLayout'
import { DATA_FORMATS, PREVIEW_ROWS, downloadExport, fetchExportText, type DataFormat } from '../lib/dataTransfer'

/**
 * Export mode: tick tables, pick a format, and the preview shows the start of
 * the very file the Export button saves — the same server formatter, capped at
 * PREVIEW_ROWS rows per table.
 */
export default function DataExportPane({ conn, tables, switcher }: { conn: any; tables: string[]; switcher: ReactNode }) {
  const toast = useToast()
  const [selected, setSelected] = useState<string[]>([])
  const [format, setFormat] = useState<DataFormat>('json')
  const [includeSchema, setIncludeSchema] = useState(false)
  const [preview, setPreview] = useState<{ text?: string; error?: string; loading?: boolean }>({})
  const [exporting, setExporting] = useState(false)
  const latest = useRef(0)

  // Keep the selection in table-list order, whatever order it was ticked in.
  const picked = tables.filter((t) => selected.includes(t))
  const allSelected = tables.length > 0 && picked.length === tables.length
  const schemaOption = format !== 'csv' // a CSV file has nowhere to put DDL

  useEffect(() => {
    if (!picked.length) {
      setPreview({})
      return
    }
    const id = ++latest.current
    setPreview((p) => ({ ...p, loading: true }))
    const timer = setTimeout(async () => {
      try {
        const opts = { format, includeSchema: schemaOption && includeSchema, limit: PREVIEW_ROWS }
        // One CSV per table, so the preview stacks them under a heading each.
        const text =
          format === 'csv'
            ? (await Promise.all(picked.map(async (t) => `# ${t}.csv\n${await fetchExportText(conn, { ...opts, tables: [t] })}`))).join('\n')
            : await fetchExportText(conn, { ...opts, tables: picked })
        if (id === latest.current) setPreview({ text })
      } catch (error: any) {
        if (id === latest.current) setPreview({ error: error.message })
      }
    }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked.join('\u0000'), format, includeSchema, conn.id, conn.ns?.database, conn.ns?.schema])

  const runExport = async () => {
    setExporting(true)
    try {
      await downloadExport(conn, { tables: picked, format, includeSchema: schemaOption && includeSchema })
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <TransferLayout
      toolbar={
        <>
          {switcher}
          <ToolbarDivider />
          <Button variant="primary" icon={DownloadIcon} onClick={runExport} disabled={!picked.length || exporting}>
            {exporting ? 'Exporting…' : 'Export'}
          </Button>
          <ToolbarDivider />
          <Segmented value={format} onChange={setFormat} options={DATA_FORMATS} />
          <ToolbarDivider />
          <ToolbarCheck checked={schemaOption && includeSchema} onChange={setIncludeSchema} disabled={!schemaOption} label="Include schema" />
          {format === 'csv' && picked.length > 1 && (
            <span className="text-[11px] text-ink-faint">One CSV file per table</span>
          )}
        </>
      }
      side={
        <>
          <SectionHeader>
            <span>
              {picked.length ? `${picked.length} of ` : ''}
              {tables.length} table{tables.length === 1 ? '' : 's'}
            </span>
            {tables.length > 0 && (
              <TextButton className="!text-xs" onClick={() => setSelected(allSelected ? [] : tables)}>{allSelected ? 'Clear' : 'Select All'}</TextButton>
            )}
          </SectionHeader>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {tables.length === 0 ? (
              <PreviewMessage>No tables to export.</PreviewMessage>
            ) : (
              tables.map((t) => (
                <TableRow
                  key={t}
                  checked={selected.includes(t)}
                  onChange={() => setSelected((s) => toggleId(s, t))}
                  icon={<TableIcon width={15} height={15} />}
                name={t}
                />
              ))
            )}
          </div>
        </>
      }
      previewTitle={
        <>
          <span>Preview (first {PREVIEW_ROWS} rows per table)</span>
          {preview.loading && <span className="text-ink-faint">Loading…</span>}
        </>
      }
      preview={
        preview.error ? (
          <PreviewMessage tone="error">{preview.error}</PreviewMessage>
        ) : preview.text != null && picked.length ? (
          <pre className="whitespace-pre p-4 font-mono text-[11px] leading-5 text-ink-dim">{preview.text}</pre>
        ) : (
          <PreviewMessage>Select tables to preview</PreviewMessage>
        )
      }
    />
  )
}
