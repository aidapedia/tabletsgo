import { useEffect, useRef, useState } from 'react'
import { runQuery } from '@/shared/api/database'
import PagedDataGrid from '@/shared/ui/table/PagedDataGrid'
import CommandReference from '@/shared/ui/CommandReference'
import { toast } from 'sonner'
import { ChevronDown, InfoIcon, SaveIcon } from '@/shared/ui/icons'
import { formatCombo, useKeymap, useShortcut } from '@/features/keymap'
import { useEngineLimits } from '@/features/modules'
import KafkaEditor from './KafkaEditor'
import { kafkaCommandDoc } from '../lib/docs'
import { listGroups, listTopics } from '../lib/api'
import { buffersWrites, findKafkaCommand, KAFKA_COMMANDS } from '../lib/commands'
import { Button } from '@/shared/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

const MIN_PANE = 100 // px — floor for both the editor and results panes while dragging

// The topic or group a command line is about, for the history's table column.
function subjectOf(line: string) {
  const [name, first, second] = line.trim().split(/\s+/)
  const spec = findKafkaCommand(name)
  if (!spec) return null
  if (spec.takes) return first || null
  if (/^(CREATE|DROP)$/i.test(name) && /^TOPIC$/i.test(first || '')) return second || null
  return null
}

/**
 * The Kafka command console — the query tab for a Kafka connection. One command
 * per line; a single command shows its rows, a buffer of several shows one
 * summary row per command so a failure in the middle is visible.
 *
 * It rides the same /query route as SQL and Redis, which is what makes a saved
 * Kafka command usable from a workflow query node or a dashboard widget.
 */
export default function KafkaConsole({ conn, initialCommand, tabKey, persisted, onPersist, onRan, onSave, onMutated }: any) {
  const { bindings } = useKeymap()
  const { queryTimeoutSec } = useEngineLimits(conn?.type)
  const [command, setCommand] = useState(persisted?.sql ?? initialCommand ?? '')
  const [result, setResult] = useState(persisted?.result ?? null)
  const [error, setError] = useState(persisted?.error ?? null)
  const [loading, setLoading] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(persisted?.elapsedMs ?? null)
  const [reference, setReference] = useState(false)
  const [topics, setTopics] = useState<string[]>([])
  const [groups, setGroups] = useState<string[]>([])

  // Names for completion — best effort, the console works without them.
  useEffect(() => {
    listTopics(conn).then((ts) => setTopics(ts.map((t) => t.name))).catch(() => {})
    listGroups(conn).then((gs) => setGroups(gs.map((g) => g.id))).catch(() => {})
  }, [conn])

  // Editor/results split — same drag-to-resize affordance as the SQL editor.
  const [editorHeight, setEditorHeight] = useState(240)
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

  // Run `text` — the whole buffer, or one example from the command reference.
  const runText = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    setError(null)
    setLoading(true)
    const startedAt = performance.now()
    const first = trimmed.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('#')) || trimmed
    try {
      const res: any = await runQuery(conn, text, { timeoutMs: queryTimeoutSec * 1000 })
      const ms = Math.round(performance.now() - startedAt)
      setElapsedMs(ms)
      if (res.error) {
        setError(res.error)
        setResult(null)
        onRan?.({ sql: trimmed, table: subjectOf(first), status: 'failed', latency: ms, error: res.error, rows: null })
        toast.error(`Command failed: ${res.error}`)
      } else {
        setResult(res)
        const rows = res.type === 'rows' ? res.rows.length : null
        onRan?.({ sql: trimmed, table: subjectOf(first), status: 'success', latency: ms, error: null, rows })
        toast.success(res.type === 'rows' ? `OK · ${rows.toLocaleString()} row(s) · ${ms} ms` : `${res.message} · ${ms} ms`)
        if (buffersWrites(trimmed)) onMutated?.()
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

  const run = () => runText(command)
  const append = (text: string) => setCommand((cur: string) => `${cur.trimEnd()}${cur.trim() ? '\n' : ''}${text}`)

  useShortcut('workspace.runQuery', run)
  useShortcut('general.save', () => onSave?.(command))

  const commandCount = command.split(/\r?\n/).filter((l: string) => l.trim() && !l.trim().startsWith('#')).length

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <Button variant="default" size="sm" onClick={run} disabled={loading}>
            {loading ? 'Running…' : `▶ Run${commandCount > 1 ? ` ${commandCount} commands` : ''}`}
            <kbd className="rounded bg-black/20 px-1.5 py-px text-[10px] font-semibold">{formatCombo(bindings['workspace.runQuery'])}</kbd>
          </Button>
          <div className="mx-0.5 h-5 w-px bg-border" />
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button variant="ghost" size="sm" className="!px-2" onClick={() => onSave?.(command)} disabled={!command.trim()}>
                  <SaveIcon width={15} height={15} />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">Save command</TooltipContent>
          </Tooltip>
          <div className="ml-auto flex items-center gap-2">
            <span className="rounded-lg border border-border bg-muted px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">Kafka · {conn?.name}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-lg" aria-pressed={reference} aria-label="Command reference" onClick={() => setReference((r) => !r)}>
                  <InfoIcon width={15} height={15} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">{reference ? 'Hide command reference' : 'Show command reference'}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div ref={paneRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={editorWrapRef}
            className={`min-h-0 shrink-0 bg-background ${dragging ? '' : 'transition-[height] duration-300 ease-in-out'}`}
            style={{ height: resultsCollapsed ? Math.max(paneHeight - 1, editorHeight) : editorHeight }}
          >
            <KafkaEditor
              value={command}
              onChange={setCommand}
              topics={topics}
              groups={groups}
              editable={!loading}
              placeholder={`One command per line — try TOPICS, then CONSUME <topic> FROM -20. ${formatCombo(bindings['workspace.runQuery'])} runs.`}
              minHeight={editorBoxHeight ? `${editorBoxHeight}px` : undefined}
              maxHeight={editorBoxHeight ? `${editorBoxHeight}px` : undefined}
            />
          </div>

          <div className={`group relative h-px shrink-0 bg-border ${resultsCollapsed ? '' : 'cursor-row-resize'}`} onMouseDown={resultsCollapsed ? undefined : startResize}>
            <div className="absolute inset-x-0 -top-1.5 -bottom-1.5" />
            <div className="absolute inset-0 group-hover:bg-primary/20" />
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`inline-flex ${`absolute left-1/2 top-1/2 -translate-x-1/2 ${resultsCollapsed ? '-translate-y-[calc(100%+8px)]' : '-translate-y-1/2'}`}`}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setResultsCollapsed((c) => !c)
                    }}
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
            {error && <div className="mx-[18px] my-4 rounded-[9px] border border-destructive/25 bg-destructive/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">{error}</div>}
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
              <div className="mx-[18px] my-4 rounded-[9px] border border-primary/25 bg-primary/10 px-3.5 py-3 font-mono text-[11px] text-primary-bright">
                {result.message}
                {elapsedMs != null && <span className="text-faint"> · {elapsedMs} ms</span>}
              </div>
            )}
            {!error && !result && (
              <div className="p-[30px] text-center text-xs text-faint">
                Run a command to see its result here. Try <span className="font-mono text-muted-foreground">TOPICS</span> or{' '}
                <span className="font-mono text-muted-foreground">GROUPS</span>.
              </div>
            )}
          </div>
        </div>
      </div>

      {reference && (
        <CommandReference
          groups={[{ commands: KAFKA_COMMANDS }]}
          onInsert={append}
          onRun={(text) => {
            append(text)
            runText(text)
          }}
          docFor={kafkaCommandDoc}
          footer={
            <>
              <span className="font-mono">WHERE</span> filters on <span className="font-mono">key</span>, <span className="font-mono">value</span>,{' '}
              <span className="font-mono">value.path</span>, <span className="font-mono">header.name</span>, <span className="font-mono">partition</span>,{' '}
              <span className="font-mono">offset</span> or <span className="font-mono">timestamp</span> with = != &gt; &lt; or ~ (contains), joined by AND.
              Every command returns rows, so it can be saved, run by a workflow or charted on a dashboard.
            </>
          }
        />
      )}
    </div>
  )
}
