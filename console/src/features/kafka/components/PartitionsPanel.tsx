import Pagination from '@/shared/ui/table/Pagination'
import usePagination from '@/shared/ui/table/usePagination'
import type { TopicDetail } from '../lib/api'
import { compact, num } from '../lib/format'
import Tile from './Tile'

/**
 * A topic's partitions: summary tiles over the per-partition table — leader,
 * replicas (filled = in sync, dashed = lagging), offsets and how evenly the
 * messages are spread. The produce rate is measured by TopicView from the end
 * offsets moving between two reads, so it shows once the second read lands.
 */
export default function PartitionsPanel({ topic, detail, rate }: { conn: any; topic: string; detail: TopicDetail | null; rate: number | null }) {
  // Keyed on the topic, so the 10 s refresh keeps the page you're on.
  const { pageRows, pager } = usePagination(detail?.partitionList ?? [], { resetKey: topic })
  if (!detail) return <div className="p-[30px] text-center text-xs text-faint">Reading {topic}…</div>

  const parts = detail.partitionList
  const largest = Math.max(1, ...parts.map((p) => p.messages))
  const lagging = parts.filter((p) => p.isr.length < p.replicas.length)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">
      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        <Tile label="Retained messages" value={compact(detail.messages)} sub="latest − earliest, all partitions" />
        <Tile label="Partitions" value={String(detail.partitions)} sub={`replication factor ${detail.replication}`} />
        <Tile
          label="Produce rate"
          value={rate == null ? '…' : rate < 10 ? rate.toFixed(1) : compact(Math.round(rate))}
          unit="msg/s"
          sub="sampled from end offsets every 10 s"
        />
        <Tile
          label="Under-replicated"
          value={String(lagging.length)}
          sub={lagging.length ? `partition ${lagging.map((p) => p.partition).join(', ')}` : 'every replica in sync'}
          warn={lagging.length > 0}
        />
      </div>

      <div className="rounded-xl border border-border bg-sidebar">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-[11px] text-faint">
              {['Partition', 'Leader', 'Replicas', 'In sync', 'Earliest', 'Latest', 'Messages', 'Share of topic'].map((h, i) => (
                <th key={h} className={`h-8 border-b border-border px-3 font-semibold ${i >= 4 && i <= 6 ? 'text-right' : ''}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((p) => {
              const behind = p.isr.length < p.replicas.length
              return (
                <tr key={p.partition} className={behind ? 'bg-warning/5' : ''}>
                  <td className="h-[30px] border-b border-border/60 px-3 font-mono font-semibold">
                    {p.partition}
                    {behind && (
                      <span className="ml-2 rounded-[5px] border border-warning/30 bg-warning/10 px-1.5 py-px font-sans text-[9px] font-bold uppercase text-warning">
                        under-replicated
                      </span>
                    )}
                  </td>
                  <td className="border-b border-border/60 px-3 text-muted-foreground">{p.leader < 0 ? <span className="text-destructive">offline</span> : `broker ${p.leader}`}</td>
                  <td className="border-b border-border/60 px-3">
                    <div className="flex gap-1">
                      {p.replicas.map((r) => (
                        <span
                          key={r}
                          title={p.isr.includes(r) ? `Broker ${r} — in sync` : `Broker ${r} — not in sync`}
                          className={`flex h-5 min-w-5 items-center justify-center rounded-[5px] px-1 text-[10px] font-semibold ${
                            p.isr.includes(r) ? 'border border-primary/40 bg-primary/15 text-primary-bright' : 'border border-dashed border-warning text-warning'
                          }`}
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className={`border-b border-border/60 px-3 ${behind ? 'font-semibold text-warning' : 'text-muted-foreground'}`}>
                    {p.isr.length} / {p.replicas.length}
                  </td>
                  <td className="border-b border-border/60 px-3 text-right font-mono tabular-nums">{num(p.low)}</td>
                  <td className="border-b border-border/60 px-3 text-right font-mono tabular-nums">{num(p.high)}</td>
                  <td className="border-b border-border/60 px-3 text-right font-mono tabular-nums">{num(p.messages)}</td>
                  <td className="border-b border-border/60 px-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, Math.round((p.messages / largest) * 100))}%` }} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
        <Pagination className="px-3 py-1.5 text-[11px]" {...pager} />
      </div>
      <p className="mt-2.5 text-[11px] text-faint">Refreshed every 10 s while this view is open.</p>
    </div>
  )
}
