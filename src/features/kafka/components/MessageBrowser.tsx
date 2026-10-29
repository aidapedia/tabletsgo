import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import Select from '@/shared/ui/form/Select'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import { controlClass, Input } from '@/shared/ui/form/Input'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CloseIcon, CodeIcon, CopyIcon, DownloadIcon, PlayIcon, SendIcon } from '@/shared/ui/icons'
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

/**
 * A topic's messages: a bounded read with a filter bar, a grid and the selected
 * message in full beside it. Every fetch is one request to
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
  const [selected, setSelected] = useState<string | null>(null)

  const position = () => {
    if (from === 'offset') return `offset:${parseInt(offset) || 0}`
    if (from === 'time') return time ? `ts:${new Date(time).toISOString()}` : 'latest'
    return from
  }

  const fetchPage = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await readMessages(conn, topic, {
        partition: partition === '' ? null : Number(partition),
        from: position(),
        limit: Number(limit),
        filter,
        decode,
      })
      setPage(res)
      setRows(res.rows)
      setSelected(res.rows[0] ? keyOf(res.rows[0]) : null)
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
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[640px] table-fixed border-collapse text-[12px]">
                <colgroup>
                  <col className="w-[52px]" />
                  <col className="w-[100px]" />
                  <col className="w-[140px]" />
                  <col className="w-[150px]" />
                  <col />
                  <col className="w-[72px]" />
                </colgroup>
                <thead className="sticky top-0 z-[1] bg-panel">
                  <tr className="text-left text-[11px] text-ink-faint">
                    <th className="h-8 border-b border-edge px-3 text-right font-semibold">Part.</th>
                    <th className="h-8 border-b border-edge px-3 text-right font-semibold">Offset</th>
                    <th className="h-8 border-b border-edge px-3 font-semibold">Timestamp</th>
                    <th className="h-8 border-b border-edge px-3 font-semibold">Key</th>
                    <th className="h-8 border-b border-edge px-3 font-semibold">Value</th>
                    <th className="h-8 border-b border-edge px-3 text-right font-semibold">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const on = keyOf(r) === selected
                    return (
                      <tr
                        key={keyOf(r)}
                        onClick={() => setSelected(keyOf(r))}
                        aria-selected={on}
                        className={`cursor-pointer ${on ? 'bg-green-dim/60 shadow-[inset_2px_0_0_var(--color-green)]' : 'hover:bg-elevated'}`}
                      >
                        <td className="h-[30px] truncate border-b border-edge/60 px-3 text-right font-mono text-ink-dim">{r.partition}</td>
                        <td className="truncate border-b border-edge/60 px-3 text-right font-mono tabular-nums">{r.offset.toLocaleString()}</td>
                        <td className="truncate border-b border-edge/60 px-3 font-mono text-ink-dim" title={r.timestamp}>
                          {shortTime(r.timestamp)}
                        </td>
                        <td className="truncate border-b border-edge/60 px-3 font-mono" title={r.key ?? ''}>
                          {r.key ?? <span className="italic text-ink-faint">null</span>}
                        </td>
                        <td className="truncate border-b border-edge/60 px-3 font-mono text-ink-dim">
                          {r.value == null ? <span className="italic text-amber">null (tombstone)</span> : r.value}
                        </td>
                        <td className="truncate border-b border-edge/60 px-3 text-right text-ink-dim">{bytes(r.size)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
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
            onProduceCopy={() =>
              onProduceCopy({ key: current.key, value: current.value, headers: current.headers ? JSON.parse(current.headers) : null })
            }
            onRunCommand={onRunCommand}
          />
        )}
      </div>
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
  const value = prettyJson(m.value)
  const headers: Record<string, string> = m.headers ? JSON.parse(m.headers) : {}
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast.success('Copied.'))

  return (
    <aside aria-label="Message" className="flex w-[360px] shrink-0 flex-col border-l border-edge bg-panel max-[1100px]:w-[300px] max-[860px]:hidden">
      <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Message</p>
          <p className="truncate font-mono text-xs font-semibold">
            p{m.partition} · offset {m.offset.toLocaleString()}
          </p>
        </div>
        <div className="flex gap-0.5">
          <Tooltip label="Copy value" placement="left">
            <IconButton aria-label="Copy value" onClick={() => copy(m.value ?? 'null')}>
              <CopyIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
          <Tooltip label="Produce a copy" placement="left">
            <IconButton aria-label="Produce a copy" onClick={onProduceCopy}>
              <SendIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
          <IconButton aria-label="Close message" onClick={onClose}>
            <CloseIcon width={12} height={12} />
          </IconButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3.5">
        <Section title="Key">
          <div className="break-all rounded-[8px] border border-edge bg-bg px-2.5 py-2 font-mono text-[12px]">
            {m.key ?? <span className="italic text-ink-faint">null</span>}
          </div>
        </Section>

        <Section title="Value" aside={value.json ? 'JSON' : undefined}>
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
      </div>

      <div className="flex gap-2 border-t border-edge px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          icon={CodeIcon}
          className="flex-1 justify-center"
          onClick={() => onRunCommand(`CONSUME ${topic} PARTITION ${m.partition} FROM OFFSET ${m.offset} LIMIT 1`)}
        >
          Open in console
        </Button>
        <Button variant="ghost" size="sm" icon={SendIcon} className="flex-1 justify-center" onClick={onProduceCopy}>
          Produce a copy
        </Button>
      </div>
    </aside>
  )
}

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
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

