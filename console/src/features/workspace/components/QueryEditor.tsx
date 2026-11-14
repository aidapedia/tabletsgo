import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'sql-formatter'
import { sqlDialectOf } from '@/shared/lib/sqlDialect'
import { getSchema, runQuery } from '@/shared/api/database'
import PagedDataGrid from '@/shared/ui/table/PagedDataGrid'
import CommandReference from '@/shared/ui/CommandReference'
import SqlEditor from '@/shared/ui/SqlEditor'
import { toast } from 'sonner'
import { ChevronDown, GaugeIcon, InfoIcon, SaveIcon, WandIcon } from '@/shared/ui/icons'
import useServerVersion from '@/shared/hooks/useServerVersion'
import { formatCombo, useKeymap, useShortcut } from '@/features/keymap'
import { useEngineLimits } from '@/features/modules'
import { sqlCommandDoc, sqlReferenceFor, sqlReferenceGroups } from '../lib/sql-reference'
import { Button } from '@/shared/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

const MIN_PANE = 100 // px — floor for both the editor and results panes while dragging

// Best-effort: pull the primary table name out of a SQL statement so the
// history can show which table a query touched. Returns null when unknown.
function primaryTable(sql) {
  const m = sql.match(/\b(?:from|join|into|update|table)\s+["'`]?([A-Za-z_][\w.$]*)["'`]?/i)
  return m ? m[1].replace(/^.*\./, '') : null
}

export default function QueryEditor({ conn, dialect, initialSql, tabKey, persisted, onPersist, onRan, onSave, onAnalyze }) {
  const { bindings } = useKeymap()
  const { queryTimeoutSec } = useEngineLimits(conn?.type)
  // Seed from the persisted snapshot (restored on tab switch) when present,
  // otherwise from initialSql for a fresh tab.
  const [sql, setSql] = useState(persisted?.sql ?? initialSql ?? '')
  const [schema, setSchema] = useState({})
  const [result, setResult] = useState(persisted?.result ?? null)
  const [error, setError] = useState(persisted?.error ?? null)
  const [loading, setLoading] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(persisted?.elapsedMs ?? null) // latency of last run
  const [reference, setReference] = useState(false)

  // The command reference: this engine's statements and functions, each tagged
  // with the release that brought it and dimmed when this server predates it.
  const version = useServerVersion(conn)
  const sqlRef = sqlReferenceFor(conn?.type)
  const refGroups = useMemo(() => (sqlRef ? sqlReferenceGroups(sqlRef, version) : []), [sqlRef, version])

  // Editor/results split — drag the divider to resize, or collapse the results pane.
  const [editorHeight, setEditorHeight] = useState(320)
  const [resultsCollapsed, setResultsCollapsed] = useState(false)
  const [dragging, setDragging] = useState(false)
  const paneRef = useRef(null)
  const draggingRef = useRef(false)

  // Total height of the editor+results pane, used to grow the editor to fill
  // the space vacated by the results pane when it's collapsed (animated below).
  const [paneHeight, setPaneHeight] = useState(0)
  useEffect(() => {
    const el = paneRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setPaneHeight(Math.round(entry.contentRect.height)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // CodeMirror needs a concrete pixel height, not a percentage — a percentage
  // resolves against the wrapper's height at mount time, which can still be 0
  // (flex layout not yet settled), and CodeMirror doesn't recover from that.
  // Measure the wrapper directly instead.
  const editorWrapRef = useRef(null)
  const [editorBoxHeight, setEditorBoxHeight] = useState(0)
  useEffect(() => {
    const el = editorWrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setEditorBoxHeight(Math.round(entry.contentRect.height)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const startResize = (e) => {
    e.preventDefault()
    draggingRef.current = true
    setDragging(true)
    document.body.style.cursor = 'row-resize'
    const onMove = (ev) => {
      if (!draggingRef.current || !paneRef.current) return
      const rect = paneRef.current.getBoundingClientRect()
      const max = Math.max(rect.height - MIN_PANE, MIN_PANE)
      setEditorHeight(Math.min(Math.max(ev.clientY - rect.top, MIN_PANE), max))
    }
    const onUp = () => {
      draggingRef.current = false
      setDragging(false)
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    let alive = true
    getSchema(conn).then((s) => alive && setSchema(s))
    return () => {
      alive = false
    }
  }, [conn])

  // Persist the editor's state when this tab is switched away (unmount), so its
  // SQL and result survive until the tab is closed.
  const snapshotRef = useRef(null)
  snapshotRef.current = { sql, result, error, elapsedMs }
  const persistRef = useRef(null)
  persistRef.current = () => onPersist?.(tabKey, snapshotRef.current)
  useEffect(() => () => persistRef.current?.(), [])

  // Run `text` — the whole buffer, or one example from the command reference.
  const runText = async (text) => {
    if (!text.trim() || loading) return
    setError(null)
    setLoading(true)
    const startedAt = performance.now()
    const trimmed = text.trim()
    const table = primaryTable(trimmed)
    try {
      const queryResult = await runQuery(conn, text, { timeoutMs: queryTimeoutSec * 1000 })
      const ms = Math.round(performance.now() - startedAt)
      setElapsedMs(ms)
      if (queryResult.error) {
        setError(queryResult.error)
        setResult(null)
        onRan?.({ sql: trimmed, table, status: 'failed', latency: ms, error: queryResult.error, rows: null })
        toast.error(`Query failed: ${queryResult.error}`)
      } else {
        setResult(queryResult)
        const rows = queryResult.type === 'rows' ? queryResult.rows.length : null
        onRan?.({ sql: trimmed, table, status: 'success', latency: ms, error: null, rows })
        toast.success(
          queryResult.type === 'rows'
            ? `Query OK · ${rows.toLocaleString()} row(s) · ${ms} ms`
            : `${queryResult.message || 'Query executed successfully.'} · ${ms} ms`
        )
      }
    } catch (e) {
      const ms = Math.round(performance.now() - startedAt)
      setElapsedMs(ms)
      setResult(null)
      setError(e.message)
      onRan?.({ sql: trimmed, table, status: 'failed', latency: ms, error: e.message, rows: null })
      toast.error(`Query failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  const run = () => runText(sql)
  const append = (text) => setSql((cur) => `${cur.trimEnd()}${cur.trim() ? '\n' : ''}${text}`)

  const beautify = () => {
    try {
      setSql(
        format(sql, {
          language: sqlDialectOf(conn.type),
          keywordCase: 'upper',
          tabWidth: 2,
        })
      )
    } catch {
      /* leave the SQL untouched if it can't be parsed */
    }
  }

  useShortcut('workspace.runQuery', run)
  useShortcut('general.save', () => onSave?.(sql))

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <Button variant="default" size="sm" onClick={run} disabled={loading}>
            {loading ? 'Running…' : '▶ Run Query'}
            <kbd className="rounded bg-black/20 px-1.5 py-px text-[10px] font-semibold">
              {formatCombo(bindings['workspace.runQuery'])}
            </kbd>
          </Button>

          <div className="mx-0.5 h-5 w-px bg-border" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="!px-2" onClick={beautify}>
                <WandIcon width={15} height={15} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Beautify SQL</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  variant="ghost"
                  size="sm"
                  className="!px-2"
                  onClick={() => onSave?.(sql)}
                  disabled={!sql.trim()}
                >
                  <SaveIcon width={15} height={15} />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">Save query</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  variant="ghost"
                  size="sm"
                  className="!px-2"
                  onClick={() => onAnalyze?.(sql)}
                  disabled={!sql.trim()}
                >
                  <GaugeIcon width={15} height={15} />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">Analyze performance</TooltipContent>
          </Tooltip>

          <div className="ml-auto flex items-center gap-2">
            <span className="rounded-lg border border-border bg-muted px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
              {dialect}
              {version && <span className="ml-1 font-mono font-normal text-faint">{version}</span>}
            </span>
            {sqlRef && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-lg" aria-pressed={reference} aria-label="Command reference" onClick={() => setReference((r) => !r)}>
                    <InfoIcon width={15} height={15} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">{reference ? 'Hide command reference' : 'Show command reference'}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        <div ref={paneRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={editorWrapRef}
            className={`min-h-0 shrink-0 bg-background ${dragging ? '' : 'transition-[height] duration-300 ease-in-out'}`}
            style={{ height: resultsCollapsed ? Math.max(paneHeight - 1, editorHeight) : editorHeight }}
          >
            <SqlEditor
              value={sql}
              onChange={setSql}
              dialect={conn.type}
              schema={schema}
              editable={!loading}
              placeholder={`Write SQL and press ${formatCombo(bindings['workspace.runQuery'])} to run…`}
              minHeight={editorBoxHeight ? `${editorBoxHeight}px` : undefined}
              maxHeight={editorBoxHeight ? `${editorBoxHeight}px` : undefined}
            />
          </div>

          <div
            className={`group relative h-px shrink-0 bg-border ${resultsCollapsed ? '' : 'cursor-row-resize'}`}
            onMouseDown={resultsCollapsed ? undefined : startResize}
          >
            {/* wider invisible hit area so the 1px line is still easy to grab */}
            <div className="absolute inset-x-0 -top-1.5 -bottom-1.5" />
            <div className="absolute inset-0 group-hover:bg-primary/20" />
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`inline-flex ${`absolute left-1/2 top-1/2 -translate-x-1/2 ${resultsCollapsed ? '-translate-y-[calc(100%+8px)]' : '-translate-y-1/2'}`}`}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setResultsCollapsed((c) => !c) }}
                    onMouseDown={(e) => e.stopPropagation()}
                    aria-label={resultsCollapsed ? 'Expand results' : 'Collapse results'}
                    className="flex h-5 w-9 items-center justify-center rounded-full border border-border bg-sidebar text-muted-foreground transition-colors hover:border-input hover:text-foreground"
                  >
                    <ChevronDown width={13} height={13} className={`transition-transform ${resultsCollapsed ? 'rotate-180' : ''}`} />
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent side={resultsCollapsed ? 'top' : 'bottom'}>{resultsCollapsed ? 'Expand results' : 'Collapse results'}</TooltipContent>
            </Tooltip>
          </div>

          <div
            className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-opacity duration-300 ease-in-out ${
              resultsCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
            }`}
            aria-hidden={resultsCollapsed}
          >
            {error && (
              <div className="mx-[18px] my-4 rounded-[9px] border border-destructive/25 bg-destructive/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">
                {error}
              </div>
            )}
            {!error && result?.type === 'rows' && (
              <>
                <div className="border-b border-border px-[18px] py-2 text-xs text-muted-foreground">
                  {result.rows.length} row(s)
                  {elapsedMs != null && <span className="text-faint"> · {elapsedMs} ms</span>}
                </div>
                <PagedDataGrid columns={result.columns} rows={result.rows} resetKey={result} />
              </>
            )}
            {!error && result?.type === 'message' && (
              <div className="mx-[18px] my-4 rounded-[9px] border border-primary/25 bg-primary/10 px-3.5 py-3 text-[11px] text-primary-bright">
                {result.message}
              </div>
            )}
            {!error && !result && (
              <div className="p-[30px] text-center text-faint">Run a query to see results here.</div>
            )}
          </div>
        </div>
      </div>

      {reference && sqlRef && (
        <CommandReference
          groups={refGroups}
          filterable
          onInsert={append}
          onRun={(text) => {
            append(text)
            runText(text)
          }}
          docFor={(name) => sqlCommandDoc(sqlRef, name, version)}
          footer={
            <>
              Each entry shows the {sqlRef.engine} release that introduced it; one newer than this server is dimmed.
              Click a row to insert it, or its chevron for details and examples.
            </>
          }
        />
      )}
    </div>
  )
}
