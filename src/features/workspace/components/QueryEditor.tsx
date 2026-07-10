import { useEffect, useRef, useState } from 'react'
import { format } from 'sql-formatter'
import { getSchema, runQuery } from '@/shared/api/database'
import DataGrid from '@/features/workspace/components/DataGrid'
import Button from '@/shared/ui/buttons/Button'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import SqlEditor from '@/shared/ui/SqlEditor'
import { useToast } from '@/shared/ui/feedback/Toast'
import { ChevronDown, SaveIcon, WandIcon } from '@/shared/ui/icons'
import { formatCombo, useKeymap, useShortcut } from '@/features/keymap'

const MIN_PANE = 100 // px — floor for both the editor and results panes while dragging

// Best-effort: pull the primary table name out of a SQL statement so the
// history can show which table a query touched. Returns null when unknown.
function primaryTable(sql) {
  const m = sql.match(/\b(?:from|join|into|update|table)\s+["'`]?([A-Za-z_][\w.$]*)["'`]?/i)
  return m ? m[1].replace(/^.*\./, '') : null
}

export default function QueryEditor({ conn, dialect, initialSql, tabKey, persisted, onPersist, onRan, onSave }) {
  const toast = useToast()
  const { bindings } = useKeymap()
  // Seed from the persisted snapshot (restored on tab switch) when present,
  // otherwise from initialSql for a fresh tab.
  const [sql, setSql] = useState(persisted?.sql ?? initialSql ?? '')
  const [schema, setSchema] = useState({})
  const [result, setResult] = useState(persisted?.result ?? null)
  const [error, setError] = useState(persisted?.error ?? null)
  const [loading, setLoading] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(persisted?.elapsedMs ?? null) // latency of last run

  // Editor/results split — drag the divider to resize, or collapse the results pane.
  const [editorHeight, setEditorHeight] = useState(320)
  const [resultsCollapsed, setResultsCollapsed] = useState(false)
  const paneRef = useRef(null)
  const draggingRef = useRef(false)

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
    document.body.style.cursor = 'row-resize'
    const onMove = (ev) => {
      if (!draggingRef.current || !paneRef.current) return
      const rect = paneRef.current.getBoundingClientRect()
      const max = Math.max(rect.height - MIN_PANE, MIN_PANE)
      setEditorHeight(Math.min(Math.max(ev.clientY - rect.top, MIN_PANE), max))
    }
    const onUp = () => {
      draggingRef.current = false
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

  const run = async () => {
    if (!sql.trim() || loading) return
    setError(null)
    setLoading(true)
    const startedAt = performance.now()
    const trimmed = sql.trim()
    const table = primaryTable(trimmed)
    try {
      const queryResult = await runQuery(conn, sql)
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

  const beautify = () => {
    try {
      setSql(
        format(sql, {
          language: conn.type === 'postgresql' ? 'postgresql' : 'sqlite',
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        <Button variant="primary" size="sm" onClick={run} disabled={loading}>
          {loading ? 'Running…' : '▶ Run Query'}
          <kbd className="rounded bg-black/20 px-1.5 py-px text-[10px] font-semibold">
            {formatCombo(bindings['workspace.runQuery'])}
          </kbd>
        </Button>

        <div className="mx-0.5 h-5 w-px bg-edge" />

        <Tooltip label="Beautify SQL" placement="bottom">
          <Button variant="subtle" size="sm" className="!px-2" onClick={beautify}>
            <WandIcon width={15} height={15} />
          </Button>
        </Tooltip>
        <Tooltip label="Save query" placement="bottom">
          <Button
            variant="subtle"
            size="sm"
            className="!px-2"
            onClick={() => onSave?.(sql)}
            disabled={!sql.trim()}
          >
            <SaveIcon width={15} height={15} />
          </Button>
        </Tooltip>

        <span className="ml-auto rounded-soft border border-edge bg-elevated px-3 py-1.5 text-[11px] font-semibold text-ink-dim">
          {dialect}
        </span>
      </div>

      <div ref={paneRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={editorWrapRef}
          className={`min-h-0 bg-bg ${resultsCollapsed ? 'flex-1' : 'flex-none'}`}
          style={resultsCollapsed ? undefined : { height: editorHeight }}
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
          className={`group relative h-px shrink-0 bg-edge ${resultsCollapsed ? '' : 'cursor-row-resize'}`}
          onMouseDown={resultsCollapsed ? undefined : startResize}
        >
          {/* wider invisible hit area so the 1px line is still easy to grab */}
          <div className="absolute inset-x-0 -top-1.5 -bottom-1.5" />
          <div className="absolute inset-0 group-hover:bg-green-dim" />
          <Tooltip
            label={resultsCollapsed ? 'Expand results' : 'Collapse results'}
            placement={resultsCollapsed ? 'top' : 'bottom'}
            wrapperClassName={`absolute left-1/2 top-1/2 -translate-x-1/2 ${resultsCollapsed ? '-translate-y-[calc(100%+8px)]' : '-translate-y-1/2'}`}
          >
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setResultsCollapsed((c) => !c) }}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={resultsCollapsed ? 'Expand results' : 'Collapse results'}
              className="flex h-5 w-9 items-center justify-center rounded-full border border-edge bg-panel text-ink-dim shadow-[0_6px_16px_-6px_rgba(0,0,0,0.6)] transition-colors hover:border-edge-strong hover:text-ink"
            >
              <ChevronDown width={13} height={13} className={`transition-transform ${resultsCollapsed ? 'rotate-180' : ''}`} />
            </button>
          </Tooltip>
        </div>

        {!resultsCollapsed && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {error && (
              <div className="mx-[18px] my-4 rounded-[9px] border border-red/25 bg-red/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">
                {error}
              </div>
            )}
            {!error && result?.type === 'rows' && (
              <>
                <div className="border-b border-edge px-[18px] py-2 text-xs text-ink-dim">
                  {result.rows.length} row(s)
                  {elapsedMs != null && <span className="text-ink-faint"> · {elapsedMs} ms</span>}
                </div>
                <DataGrid columns={result.columns} rows={result.rows} />
              </>
            )}
            {!error && result?.type === 'message' && (
              <div className="mx-[18px] my-4 rounded-[9px] border border-green-dim bg-green/10 px-3.5 py-3 text-[11px] text-green-bright">
                {result.message}
              </div>
            )}
            {!error && !result && (
              <div className="p-[30px] text-center text-ink-faint">Run a query to see results here.</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
