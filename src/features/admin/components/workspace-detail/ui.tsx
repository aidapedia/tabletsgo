import type { ReactNode } from 'react'
import { formatDate as zonedDate, formatDateTime as zonedDateTime } from '@/shared/lib/datetime'

// The pieces every tab of the workspace detail page is built from.

export const formatDate = (ts?: number | null) =>
  ts ? zonedDate(ts, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export const formatDateTime = (ts?: number | null) =>
  ts ? zonedDateTime(ts, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

export const formatCount = (n: number) => n.toLocaleString()

export const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1)

export function Card({ title, aside, children }: { title?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-card border border-edge bg-card p-4">
      {(title || aside) && (
        <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-bold">{title}</h2>
          {aside && <span className="text-[12px] text-ink-dim">{aside}</span>}
        </div>
      )}
      {children}
    </section>
  )
}

export function StatTile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-card border border-edge bg-card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-dim">{label}</div>
      <div className="mt-2 text-[28px] font-bold tabular-nums tracking-[-0.6px]">{value}</div>
      {sub && <div className="mt-1 text-[12px] text-ink-dim">{sub}</div>}
    </div>
  )
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3">{children}</div>
}

/** A labelled share of the largest row in its list: one hue, so nothing reads as a category. */
export function Meter({ label, count, max, meta, mono = false }: { label: string; count: number; max: number; meta?: ReactNode; mono?: boolean }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className={`flex min-w-0 items-center gap-1.5 ${mono ? 'font-mono' : ''}`}>
          <span className="truncate">{label}</span>
          {meta}
        </span>
        <span className="tabular-nums text-ink-dim">{formatCount(count)}</span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-[3px] bg-elevated">
        <div className="h-full rounded-[3px] bg-green" style={{ width: `${max ? (count / max) * 100 : 0}%` }} />
      </div>
    </div>
  )
}
