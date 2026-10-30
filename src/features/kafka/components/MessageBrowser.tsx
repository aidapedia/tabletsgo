import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import Select from '@/shared/ui/form/Select'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import ContextMenu from '@/shared/ui/overlay/ContextMenu'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import DataGrid, { cellText } from '@/shared/ui/table/DataGrid'
import { controlClass, Input } from '@/shared/ui/form/Input'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CodeIcon, CopyIcon, DownloadIcon, EyeIcon, FilterIcon, PlayIcon, SendIcon } from '@/shared/ui/icons'
import { readMessages, type MessagePage, type MessageRow } from '../lib/api'
import { bytes, prettyJson, shortTime } from '../lib/format'

const FROM_OPTIONS = [
  { value: 'latest', label: 'Newest' },
  { value: 'earliest', label: 'Oldest' },
  { value: 'offset', label: 'From offset…' },
  { value: 'time', label: 'From time…' },
]
const LIMITS = [20, 50, 100, 200, 500].map((n) => ({ value: String(n), label: String(n) }))
const DECODERS = [
  { value: 'auto', label: 'Auto' },
  { value: 'string', label: 'String' },
  { value: 'hex', label: 'Hex' },
  { value: 'base64', label: 'Base64' },
]

const label = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint'

const COLUMNS = ['partition', 'offset', 'timestamp', 'key', 'value', 'size']
const COLUMN_WIDTHS = { partition: 80, offset: 100, timestamp: 150, size: 80, value: 420 }

// A filter literal: a doubled quote is the filter language's literal quote.
const quote = (s: string) => `'${s.replace(/'/g, "''")}'`

/**
 * A topic's messages: a bounded read with a filter bar, the shared DataGrid the
 * SQL and Redis consoles use, and — from a row's right-click menu — the message
 * in full beside it. Every fetch is one request to
 * `/streams/topics/:topic/messages` — no consumer group, no commit, capped by
 * the server's read limits (the footer says when a cap cut it short).
 */
export default function MessageBrowser({
  conn,
  topic,
  partitions,
  onProduceCopy,
  onRunCommand,
}: {
  conn: any
  topic: string
  partitions: number
  onProduceCopy: (draft: { key?: string | null; value?: string | null; headers?: Record<string, string> | null }) => void
  onRunCommand: (command: string) => void
}) {
  const toast = useToast()
  const [partition, setPartition] = useState('')
  const [from, setFrom] = useState('latest')
  const [offset, setOffset] = useState('')
  const [time, setTime] = useState('')
  const [limit, setLimit] = useState('50')
  const [filter, setFilter] = useState('')
  const [decode, setDecode] = useState('auto')
  const [page, setPage] = useState<MessagePage | null>(null)
  const [rows, setRows] = useState<MessageRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null) // the message in the inspector
  const [menu, setMenu] = useState<{ x: number; y: number; message: MessageRow; value: unknown; selection: any } | null>(null)

  const position = () => {
    if (from === 'offset') return `offset:${parseInt(offset) || 0}`
    if (from === 'time') return time ? `ts:${new Date(time).toISOString()}` : 'latest'
    return from
  }

  const fetchPage = async (where = filter) => {
    setLoading(true)
    setError(null)
    try {
      const res = await readMessages(conn, topic, {
        partition: partition === '' ? null : Number(partition),
        from: position(),
        limit: Number(limit),
        filter: where,
        decode,
      })
      setPage(res)
      setRows(res.rows)
    } catch (e: any) {
      setError(e.message)
      setPage(null)
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  // Older messages of the one partition being browsed, from the cursor down.
  const loadOlder = async () => {
    const end = page?.cursor?.[partition]
    if (partition === '' || end == null) return
    setLoading(true)
    try {
      const res = await readMessages(conn, topic, {
        partition: Number(partition),
        from: `offset:${Math.max(0, end - Number(limit))}`,
        limit: Number(limit),
        filter,
        decode,
      })
      const seen = new Set(rows.map(keyOf))
      const older = res.rows.filter((r) => r.offset < end && !seen.has(keyOf(r))).sort((a, b) => b.offset - a.offset)
      setRows((rs) => [...rs, ...older])
      setPage((p) => (p ? { ...p, cursor: { ...p.cursor, [partition]: older.length ? older[older.length - 1].offset : 0 } } : p))
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.id, topic])

  const current = rows.find((r) => keyOf(r) === selected) || null
  const canOlder = partition !== '' && page?.cursor?.[partition] != null && page.cursor[partition] > 0

  // What the grid shows; partition + offset stay raw so a grid row maps back
  // to its message through keyOf.
  const gridRows = useMemo(
    () =>
      rows.map((r) => ({
        partition: r.partition,
        offset: r.offset,
        timestamp: shortTime(r.timestamp),
        key: r.key,
        value: r.value,
        size: bytes(r.size),
      })),
    [rows]
  )
  const byKey = useMemo(() => new Map(rows.map((r) => [keyOf(r), r])), [rows])

  const openMenu = (e: any, { rowIndex, value, selection }: any) =>
    setMenu({ x: e.clientX, y: e.clientY, message: rows[rowIndex], value, selection })

  const copy = (text: string, done: string) =>
    navigator.clipboard?.writeText(text).then(
      () => toast.success(done),
      () => toast.error('Could not copy to clipboard')
    )

  const produceCopy = (m: MessageRow) =>
    onProduceCopy({ key: m.key, value: m.value, headers: m.headers ? JSON.parse(m.headers) : null })

  const filterByKey = (key: string | null) => {
    const where = key == null ? 'key = null' : `key = ${quote(key)}`
    setFilter(where)
    fetchPage(where)
  }

  const download = () => {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${topic}-messages.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const partitionOptions = useMemo(
    () => [{ value: '', label: `All (${partitions || '…'})` }, ...Array.from({ length: partitions }, (_, i) => ({ value: String(i), label: String(i) }))],
    [partitions]
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <form
        className="flex flex-wrap items-end gap-2.5 border-b border-edge bg-panel px-[18px] py-3"
        onSubmit={(e) => {
          e.preventDefault()
          fetchPage()
        }}
      >
        <div className="w-[96px]">
          <span className={label}>Partition</span>
          <Select className={controlClass} value={partition} onChange={setPartition} options={partitionOptions} />
        </div>
        <div className="w-[130px]">
          <span className={label}>From</span>
          <Select className={controlClass} value={from} onChange={setFrom} options={FROM_OPTIONS} />
        </div>
        {from === 'offset' && (
          <label className="w-[110px]">
            <span className={label}>Offset</span>
            <Input className="font-mono" inputMode="numeric" placeholder="0" value={offset} onChange={(e) => setOffset(e.target.value.replace(/\D/g, ''))} />
          </label>
        )}
        {from === 'time' && (
          <label className="w-[190px]">
            <span className={label}>Time</span>
            <Input type="datetime-local" step="1" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        )}
        <div className="w-[76px]">
          <span className={label}>Limit</span>
          <Select className={controlClass} value={limit} onChange={setLimit} options={LIMITS} />
        </div>
        <label className="min-w-[200px] flex-1">
          <span className={label}>Filter</span>
          <Input
            className="font-mono"
            placeholder="key = 'ord_1' AND value.amount > 100"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <div className="w-[96px]">
          <span className={label}>Decode</span>
          <Select className={controlClass} value={decode} onChange={setDecode} options={DECODERS} />
        </div>
        <Button type="submit" variant="primary" icon={PlayIcon} disabled={loading}>
          {loading ? 'Reading…' : 'Fetch'}
        </Button>
      </form>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {error && (
            <div className="mx-[18px] my-4 rounded-[9px] border border-red/25 bg-red/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">{error}</div>
          )}
          {!error && (
            <div className="flex min-h-0 flex-1 flex-col">
              {rows.length > 0 && (
                <DataGrid columns={COLUMNS} rows={gridRows} columnWidths={COLUMN_WIDTHS} onCellContextMenu={openMenu} />
              )}
              {!loading && page && !rows.length && (
                <div className="p-[30px] text-center text-xs text-ink-faint">
                  {filter.trim() ? `No messages matched in the ${page.scanned.toLocaleString()} scanned.` : 'No messages in this range.'}
                </div>
              )}
              {loading && !rows.length && <div className="p-[30px] text-center text-xs text-ink-faint">Reading {topic}…</div>}
            </div>
          )}
          {page && !error && (
            <div className="flex flex-wrap items-center gap-3 border-t border-edge px-[18px] py-2 text-[11px] text-ink-faint">
              <span>
                {rows.length.toLocaleString()} shown · {page.scanned.toLocaleString()} scanned · {page.elapsedMs} ms
                {rows.length > 0 && !current && ' · right-click a message to inspect it'}
                {page.cappedBy && (
                  <span className="text-amber"> · stopped at the {page.cappedBy === 'time' ? 'time' : 'size'} limit — narrow the range or filter</span>
                )}
              </span>
              <div className="ml-auto flex gap-2">
                {canOlder && (
                  <Button variant="ghost" size="sm" onClick={loadOlder} disabled={loading}>
                    Load older
                  </Button>
                )}
                {partition === '' && rows.length > 0 && (
                  <span className="self-center text-[10px]">Pick a partition to page further back</span>
                )}
                <Button variant="ghost" size="sm" icon={DownloadIcon} onClick={download} disabled={!rows.length}>
                  JSON
                </Button>
              </div>
            </div>
          )}
        </div>

        {current && (
          <MessageDetail
            topic={topic}
            message={current}
            onClose={() => setSelected(null)}
            onProduceCopy={() => produceCopy(current)}
            onRunCommand={onRunCommand}
          />
        )}
      </div>

      {menu &&
        (() => {
          const m = menu.message
          // Always a rectangle — a lone right-clicked cell is a 1×1 selection.
          const sel = menu.selection
          const multi = sel.cellCount > 1
          const messages: MessageRow[] = sel.rows.map((r: MessageRow) => byKey.get(keyOf(r))).filter(Boolean)
          const close = (fn: () => void) => () => {
            fn()
            setMenu(null)
          }
          return (
            <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
              <MenuItem onClick={close(() => setSelected(keyOf(m)))}>
                <EyeIcon width={14} height={14} /> Open Inspector
              </MenuItem>

              <div className="my-1 h-px bg-edge" />
              <MenuItem
                onClick={close(() =>
                  multi
                    ? copy(sel.values.map((r: unknown[]) => r.map(cellText).join('\t')).join('\n'), `Copied ${sel.cellCount} cells`)
                    : copy(cellText(menu.value), 'Copied cell value')
                )}
              >
                <CopyIcon width={14} height={14} /> Copy {multi ? `${sel.cellCount} cells` : 'cell value'}
              </MenuItem>
              <MenuItem onClick={close(() => copy(m.value ?? 'null', 'Copied value'))}>
                <CopyIcon width={14} height={14} /> Copy value
              </MenuItem>
              <MenuItem
                onClick={close(() =>
                  copy(
                    JSON.stringify(messages.length > 1 ? messages : m, null, 2),
                    messages.length > 1 ? `Copied ${messages.length} messages` : 'Copied message'
                  )
                )}
              >
                <CopyIcon width={14} height={14} /> Copy {messages.length > 1 ? `${messages.length} messages` : 'message'} as JSON
              </MenuItem>
              <MenuItem onClick={close(() => filterByKey(m.key))}>
                <FilterIcon width={14} height={14} /> Filter by this key
              </MenuItem>

              <div className="my-1 h-px bg-edge" />
              <MenuItem onClick={close(() => onRunCommand(`CONSUME ${topic} PARTITION ${m.partition} FROM OFFSET ${m.offset} LIMIT 1`))}>
                <CodeIcon width={14} height={14} /> Open in console
              </MenuItem>
              <MenuItem onClick={close(() => produceCopy(m))}>
                <SendIcon width={14} height={14} /> Produce a copy
              </MenuItem>
            </ContextMenu>
          )
        })()}
    </div>
  )
}

const keyOf = (r: MessageRow) => `${r.partition}:${r.offset}`

function MessageDetail({
  topic,
  message: m,
  onClose,
  onProduceCopy,
  onRunCommand,
}: {
  topic: string
  message: MessageRow
  onClose: () => void
  onProduceCopy: () => void
  onRunCommand: (command: string) => void
}) {
  const toast = useToast()
  const { show, close } = useSlideOver(onClose)
  const value = prettyJson(m.value)
  const headers: Record<string, string> = m.headers ? JSON.parse(m.headers) : {}
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast.success('Copied.'))

  return (
    <SlideOverPanel
      show={show}
      close={close}
      header={
        <div className="min-w-0">
          <h3 className="text-base font-bold">Inspector</h3>
          <p className="truncate font-mono text-[11px] text-ink-faint">
            {topic} · p{m.partition} · offset {m.offset.toLocaleString()}
          </p>
        </div>
      }
      bodyClassName="flex flex-col gap-4 px-5 py-4"
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            icon={CodeIcon}
            onClick={() => close(() => onRunCommand(`CONSUME ${topic} PARTITION ${m.partition} FROM OFFSET ${m.offset} LIMIT 1`))}
          >
            Open in console
          </Button>
          <Button variant="ghost" size="sm" icon={SendIcon} onClick={() => close(onProduceCopy)}>
            Produce a copy
          </Button>
        </>
      }
    >
      <Section title="Key">
        <div className="break-all rounded-[8px] border border-edge bg-bg px-2.5 py-2 font-mono text-[12px]">
          {m.key ?? <span className="italic text-ink-faint">null</span>}
        </div>
      </Section>

      <Section
        title="Value"
        aside={
          <span className="flex items-center gap-1.5">
            {value.json && 'JSON'}
            <Tooltip label="Copy value" placement="left">
              <IconButton aria-label="Copy value" onClick={() => copy(m.value ?? 'null')}>
                <CopyIcon width={13} height={13} />
              </IconButton>
            </Tooltip>
          </span>
        }
      >
        {m.value == null ? (
          <div className="rounded-[8px] border border-amber/30 bg-amber/10 px-2.5 py-2 text-[11px] text-amber">
            Tombstone: the value is null. On a compacted topic this deletes the key.
          </div>
        ) : (
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-[8px] border border-edge bg-bg px-2.5 py-2 font-mono text-[11.5px] leading-relaxed">
            {value.json ? highlightJson(value.text) : value.text}
          </pre>
        )}
      </Section>

      <Section title={`Headers · ${Object.keys(headers).length}`}>
        {Object.keys(headers).length ? (
          <div className="overflow-hidden rounded-[8px] border border-edge">
            {Object.entries(headers).map(([k, v]) => (
              <div key={k} className="flex gap-2.5 border-b border-edge/60 px-2.5 py-1.5 font-mono text-[11px] last:border-b-0">
                <span className="w-[96px] shrink-0 truncate text-ink-faint" title={k}>
                  {k}
                </span>
                <span className="min-w-0 break-all">{Array.isArray(v) ? v.join(', ') : String(v)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-ink-faint">None.</p>
        )}
      </Section>

      <Section title="Metadata">
        {[
          ['Timestamp', new Date(m.timestamp).toISOString().replace('T', ' ').replace('Z', ' UTC')],
          ['Partition', String(m.partition)],
          ['Offset', m.offset.toLocaleString()],
          ['Size', bytes(m.size)],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-edge/60 py-1.5 text-[11px] last:border-b-0">
            <span className="text-ink-faint">{k}</span>
            <span className="font-mono">{v}</span>
          </div>
        ))}
      </Section>
    </SlideOverPanel>
  )
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{title}</p>
        {aside && <span className="text-[10px] text-ink-faint">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

// Pretty JSON with keys, strings, numbers and literals coloured — the same
// palette the SQL editor uses, without pulling CodeMirror into this view.
const TOKEN = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g
function highlightJson(text: string) {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const match of text.matchAll(TOKEN)) {
    const t = match[0]
    if (match.index! > last) out.push(text.slice(last, match.index))
    const cls = t.startsWith('"')
      ? t.trimEnd().endsWith(':')
        ? 'text-[#9ecbff]'
        : 'text-green-bright'
      : /^(true|false|null)$/.test(t)
        ? 'text-[#c49bff]'
        : 'text-amber'
    out.push(
      <span key={i++} className={cls}>
        {t}
      </span>
    )
    last = match.index! + t.length
  }
  out.push(text.slice(last))
  return out
}

