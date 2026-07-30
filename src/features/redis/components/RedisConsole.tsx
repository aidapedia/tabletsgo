import { useEffect, useRef, useState } from 'react'
import { runQuery } from '@/shared/api/database'
import DataGrid from '@/features/workspace/components/DataGrid'
import Button from '@/shared/ui/buttons/Button'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import { useToast } from '@/shared/ui/feedback/Toast'
import { ChevronDown, SaveIcon } from '@/shared/ui/icons'
import { formatCombo, useKeymap, useShortcut } from '@/features/keymap'
import { useSettings } from '@/features/settings'
import RedisEditor from './RedisEditor'
import { commandAtCursor, findCommand } from '../lib/commands'

const MIN_PANE = 100 // px — floor for both the editor and results panes while dragging

// Commands that hand back a whole new picture of the keyspace — after one of
// these the sidebar's key list is stale, so the console asks for a refresh.
const MUTATING = /^(set|setex|psetex|setnx|getset|getdel|append|incr|incrby|incrbyfloat|decr|decrby|del|unlink|rename|renamenx|copy|restore|expire|pexpire|expireat|persist|[lrhsz]\w*(push|pop|add|set|rem|del|trim|insert|move|store)|xadd|xdel|xtrim|pfadd|pfmerge|geoadd|flushdb|flushall|migrate)$/i

// Best-effort "which key did this command touch", for the history's table column.
function primaryKey(command: string) {
  const [name, first] = command.trim().split(/\s+/)
  if (!name || !first) return null
  // Commands whose first argument isn't a key.
  if (/^(select|info|config|client|command|ping|echo|dbsize|flushdb|flushall|time|acl|eval|evalsha|scan|subscribe)$/i.test(name)) {
    return null
  }
  return first.replace(/^["']|["']$/g, '')
}

/**
 * The Redis command console — the query tab for a Redis connection, and the
 * only place writes happen. One command per line; the whole buffer runs in
 * order, and the batch's per-command outcome comes back as a grid so a failure
 * in the middle is visible instead of silent.
 *
 * Results go through the same DataGrid the SQL editor uses, because the server
 * normalizes every Redis reply into the same rows/message shape.
 */
export default function RedisConsole({
  conn,
  initialCommand,
  tabKey,
  persisted,
  onPersist,
  onRan,
  onSave,
  onMutated,
}: any) {
  const toast = useToast()
  const { bindings } = useKeymap()
  const { queryTimeout } = useSettings()
  const [command, setCommand] = useState(persisted?.sql ?? initialCommand ?? '')
  const [result, setResult] = useState(persisted?.result ?? null)
  const [error, setError] = useState(persisted?.error ?? null)
  const [loading, setLoading] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(persisted?.elapsedMs ?? null)

  // Editor/results split — same drag-to-resize affordance as the SQL editor.
  const [editorHeight, setEditorHeight] = useState(280)
  const [resultsCollapsed, setResultsCollapsed] = useState(false)
  const [dragging, setDragging] = useState(false)
  const paneRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const [paneHeight, setPaneHeight] = useState(0)
  useEffect(() => {
    const el = paneRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setPaneHeight(Math.round(entry.contentRect.height)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // CodeMirror needs a pixel height, not a percentage — measure the wrapper.
  const editorWrapRef = useRef<HTMLDivElement>(null)
  const [editorBoxHeight, setEditorBoxHeight] = useState(0)
  useEffect(() => {
    const el = editorWrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setEditorBoxHeight(Math.round(entry.contentRect.height)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    setDragging(true)
    document.body.style.cursor = 'row-resize'
    const onMove = (ev: MouseEvent) => {
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

  // Persist this tab's buffer + result when it's switched away (unmount).
  const snapshotRef = useRef<any>(null)
  snapshotRef.current = { sql: command, result, error, elapsedMs }
  const persistRef = useRef<any>(null)
  persistRef.current = () => onPersist?.(tabKey, snapshotRef.current)
  useEffect(() => () => persistRef.current?.(), [])

  const run = async () => {
    const trimmed = command.trim()
    if (!trimmed || loading) return
    setError(null)
    setLoading(true)
    const startedAt = performance.now()
    try {
      // The server takes Redis command text on the same /query route the SQL
      // engines use, and answers in the same shape.
      const res: any = await runQuery(conn, command, { timeoutMs: queryTimeout * 1000 })
      const ms = Math.round(performance.now() - startedAt)
      setElapsedMs(ms)
      const first = trimmed.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('#')) || trimmed
      if (res.error) {
        setError(res.error)
        setResult(null)
        onRan?.({ sql: trimmed, table: primaryKey(first), status: 'failed', latency: ms, error: res.error, rows: null })
        toast.error(`Command failed: ${res.error}`)
      } else {
        setResult(res)
        const rows = res.type === 'rows' ? res.rows.length : null
        onRan?.({ sql: trimmed, table: primaryKey(first), status: 'success', latency: ms, error: null, rows })
        toast.success(
          res.type === 'rows'
            ? `OK · ${rows.toLocaleString()} row(s) · ${ms} ms`
            : `${res.message} · ${ms} ms`
        )
        // Refresh the key tree when the buffer contained anything that writes.
        if (trimmed.split(/\r?\n/).some((l) => MUTATING.test(l.trim().split(/\s+/)[0] || ''))) onMutated?.()
      }
    } catch (e: any) {
      const ms = Math.round(performance.now() - startedAt)
      setElapsedMs(ms)
      setResult(null)
      setError(e.message)
      onRan?.({ sql: trimmed, table: null, status: 'failed', latency: ms, error: e.message, rows: null })
      toast.error(`Command failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  useShortcut('workspace.runQuery', run)
  useShortcut('general.save', () => onSave?.(command))

  // Argument hint for the command on the last non-empty line — the one the user
  // is most likely still typing.
  const lastLine = command.split(/\r?\n/).filter((l) => l.trim()).pop() || ''
  const hint = commandAtCursor(lastLine, lastLine.length) || findCommand(lastLine.trim().split(/\s+/)[0])
  const commandCount = command.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).length

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        <Button variant="primary" size="sm" onClick={run} disabled={loading}>
          {loading ? 'Running…' : `▶ Run${commandCount > 1 ? ` ${commandCount} commands` : ''}`}
          <kbd className="rounded bg-black/20 px-1.5 py-px text-[10px] font-semibold">
            {formatCombo(bindings['workspace.runQuery'])}
          </kbd>
        </Button>

        <div className="mx-0.5 h-5 w-px bg-edge" />

        <Tooltip label="Save command" placement="bottom">
          <Button variant="subtle" size="sm" className="!px-2" onClick={() => onSave?.(command)} disabled={!command.trim()}>
            <SaveIcon width={15} height={15} />
          </Button>
        </Tooltip>

        {/* redis.io-style argument template for the command being typed. */}
        {hint && (
          <span className="min-w-0 truncate font-mono text-[11px] text-ink-faint">
            <span className="text-ink-dim">{hint.name}</span> {hint.args}
          </span>
        )}

        <span className="ml-auto rounded-soft border border-edge bg-elevated px-3 py-1.5 text-[11px] font-semibold text-ink-dim">
          Redis · {conn?.ns?.database || 'db0'}
        </span>
      </div>

      <div ref={paneRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={editorWrapRef}
          className={`min-h-0 shrink-0 bg-bg ${dragging ? '' : 'transition-[height] duration-300 ease-in-out'}`}
          style={{ height: resultsCollapsed ? Math.max(paneHeight - 1, editorHeight) : editorHeight }}
        >
          <RedisEditor
            value={command}
            onChange={setCommand}
            editable={!loading}
            placeholder={`One command per line — press ${formatCombo(bindings['workspace.runQuery'])} to run…`}
            minHeight={editorBoxHeight ? `${editorBoxHeight}px` : undefined}
            maxHeight={editorBoxHeight ? `${editorBoxHeight}px` : undefined}
          />
        </div>

        <div
          className={`group relative h-px shrink-0 bg-edge ${resultsCollapsed ? '' : 'cursor-row-resize'}`}
          onMouseDown={resultsCollapsed ? undefined : startResize}
        >
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
              className="flex h-5 w-9 items-center justify-center rounded-full border border-edge bg-panel text-ink-dim transition-colors hover:border-edge-strong hover:text-ink"
            >
              <ChevronDown width={13} height={13} className={`transition-transform ${resultsCollapsed ? 'rotate-180' : ''}`} />
            </button>
          </Tooltip>
        </div>

        <div
          className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-opacity duration-300 ease-in-out ${
            resultsCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
          }`}
          aria-hidden={resultsCollapsed}
        >
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
            <div className="mx-[18px] my-4 rounded-[9px] border border-green-dim bg-green/10 px-3.5 py-3 font-mono text-[11px] text-green-bright">
              {result.message}
              {elapsedMs != null && <span className="text-ink-faint"> · {elapsedMs} ms</span>}
            </div>
          )}
          {!error && !result && (
            <div className="p-[30px] text-center text-xs text-ink-faint">
              Run a command to see its reply here. Try <span className="font-mono text-ink-dim">INFO server</span> or{' '}
              <span className="font-mono text-ink-dim">SCAN 0 COUNT 20</span>.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
