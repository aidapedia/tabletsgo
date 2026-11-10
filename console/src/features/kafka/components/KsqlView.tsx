import { useEffect, useRef, useState } from 'react'
import DataGrid from '@/shared/ui/table/DataGrid'
import NumberStepper from '@/shared/ui/form/NumberStepper'
import { formatCombo, useKeymap, useShortcut } from '@/features/keymap'
import { runStreamSql, type SqlResult } from '../lib/api'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/switch'
import { Textarea } from '@/shared/ui/textarea'

/**
 * A KSQL tab. Statements run together and each answers on its own; a SELECT
 * runs alone and is bounded like a topic read — a push query (EMIT CHANGES)
 * returns what arrived within the row limit or the read timeout, then stops.
 * The buffer and results survive switching tabs, like the Kafka console's.
 */
export default function KsqlView({
  conn,
  tabKey,
  initialSql,
  autoRun = false,
  persisted,
  onPersist,
  onChanged,
}: {
  conn: any
  tabKey: string
  initialSql?: string
  /** Run `initialSql` as the tab opens (Describe / Explain from the sidebar). */
  autoRun?: boolean
  persisted?: any
  onPersist?: (key: string, snapshot: any) => void
  /** A statement may have created, dropped or terminated something — the sidebar re-reads. */
  onChanged?: () => void
}) {
  const { bindings } = useKeymap()
  const [sql, setSql] = useState<string>(persisted?.sql ?? initialSql ?? '')
  const [fromStart, setFromStart] = useState<boolean>(persisted?.fromStart ?? true)
  const [limit, setLimit] = useState<number | null>(persisted?.limit ?? 100)
  const [results, setResults] = useState<SqlResult[] | null>(persisted?.results ?? null)
  const [error, setError] = useState<string | null>(persisted?.error ?? null)
  const [elapsed, setElapsed] = useState<number | null>(persisted?.elapsed ?? null)
  const [running, setRunning] = useState(false)

  // Keep this tab's buffer + results when it's switched away (unmount).
  const snapshotRef = useRef<any>(null)
  snapshotRef.current = { sql, fromStart, limit, results, error, elapsed }
  const persistRef = useRef<any>(null)
  persistRef.current = () => onPersist?.(tabKey, snapshotRef.current)
  useEffect(() => () => persistRef.current?.(), [])

  const run = async (text = sql) => {
    if (!text.trim() || running) return
    setRunning(true)
    setError(null)
    const started = performance.now()
    try {
      const r = await runStreamSql(conn, text, { properties: fromStart ? { 'auto.offset.reset': 'earliest' } : {}, limit: limit || undefined })
      setResults(r.results)
      if (!/^\s*(SELECT|PRINT)\b/i.test(text)) onChanged?.()
    } catch (e: any) {
      setResults(null)
      setError(e.message)
    } finally {
      setElapsed(Math.round(performance.now() - started))
      setRunning(false)
    }
  }

  // Opened to run something (and never run before): run it once.
  useEffect(() => {
    if (autoRun && !persisted && initialSql) run(initialSql)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useShortcut('workspace.runQuery', () => run())

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2">
        <Button variant="default" size="sm" onClick={() => run()} disabled={running || !sql.trim()}>
          {running ? 'Running…' : '▶ Run'}
          <kbd className="rounded bg-black/20 px-1.5 py-px text-[10px] font-semibold">{formatCombo(bindings['workspace.runQuery'])}</kbd>
        </Button>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground" title="auto.offset.reset=earliest — a query reads the source from the start instead of only new rows.">
          <Switch checked={fromStart} onCheckedChange={(checked) => setFromStart(checked === true)} aria-label="Read from the beginning" />
          From the beginning
        </label>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          Row limit
          <NumberStepper value={limit} onChange={setLimit} min={1} max={10000} className="w-[110px]" />
        </label>
        <span className="ml-auto text-[11px] text-faint">Statements end with “;”. A SELECT runs on its own.</span>
      </div>
      <div className="shrink-0 border-b border-border">
        <Textarea
          className="!h-[180px] !rounded-none !border-0 font-mono !text-[12px] leading-relaxed"
          spellCheck={false}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder="SELECT * FROM my_stream EMIT CHANGES;"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <div className="mx-[18px] my-4 whitespace-pre-wrap rounded-[9px] border border-destructive/25 bg-destructive/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">{error}</div>}
        {!error && !results && <div className="p-[30px] text-center text-xs text-faint">{running ? 'Running…' : 'Run a statement to see its result here.'}</div>}
        {!error &&
          results?.map((r, i) => (
            <div key={i} className="border-b border-border">
              <div className="flex items-center gap-2 px-[18px] py-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground" title={r.statement}>
                  {r.statement}
                </span>
                {r.type === 'rows' && (
                  <span className="shrink-0 text-faint">
                    {r.rows.length} row{r.rows.length === 1 ? '' : 's'}
                    {r.truncated ? ` · stopped at the ${r.cappedBy === 'rows' ? 'row limit' : 'time limit'}` : ''}
                    {i === 0 && elapsed != null ? ` · ${elapsed} ms` : ''}
                  </span>
                )}
              </div>
              {r.message && <div className="mx-[18px] mb-2 rounded-[9px] border border-primary/25 bg-primary/10 px-3.5 py-2 font-mono text-[11px] text-primary-bright">{r.message}</div>}
              {r.type === 'rows' && (
                <div className="flex h-[300px] min-h-0 flex-col">
                  <DataGrid columns={r.columns} rows={r.rows} />
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  )
}
