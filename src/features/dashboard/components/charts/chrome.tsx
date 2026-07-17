import { useEffect, useRef, useState, type ReactNode } from 'react'

// Shared chrome for the hand-rolled SVG charts: hover tooltip, legend, and the
// mount-in animation trigger.

/**
 * `false` for one frame after `key` changes (new data), then `true` — flip a
 * CSS transition from its 0 state to its real state so marks animate in on
 * first paint and whenever the underlying data changes, not on every
 * re-render (hover, etc).
 */
export function useMountAnimation(key: unknown): boolean {
  const [ready, setReady] = useState(false)
  const keyRef = useRef<unknown>(undefined)

  if (keyRef.current !== key) {
    keyRef.current = key
    if (ready) {
      // Reset synchronously (before paint) so the next effect can animate in again.
      setReady(false)
    }
  }

  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [key])

  return ready
}

export const fmtNum = (v: unknown): string => {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v ?? '—')
  if (Number.isInteger(n)) return n.toLocaleString()
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export type TipRow = { color?: string; name: string; value: ReactNode }

/**
 * Hover tooltip, absolutely positioned inside the chart container (which must
 * be `relative`). Flips to the left of the cursor near the right edge.
 */
export function ChartTip({
  x,
  y,
  width,
  title,
  rows,
}: {
  x: number
  y: number
  width: number
  title?: string
  rows: TipRow[]
}) {
  const flip = x > width * 0.6
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[110px] max-w-[240px] rounded-soft border border-edge-strong bg-elevated px-2.5 py-2 text-[11px] shadow-lg"
      style={{ left: x, top: y, transform: `translate(${flip ? 'calc(-100% - 10px)' : '10px'}, -50%)` }}
    >
      {title !== undefined && title !== '' && <div className="mb-1 truncate font-semibold text-ink">{title}</div>}
      <div className="space-y-0.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5 text-ink-dim">
            {r.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} />}
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span className="shrink-0 font-medium text-ink tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Color-dot legend row (identity is also in the tooltip, never color alone). */
export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-2 pb-1">
      {items.map((it) => (
        <span key={it.label} className="flex min-w-0 items-center gap-1.5 text-[10px] text-ink-dim">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: it.color }} />
          <span className="truncate">{it.label}</span>
        </span>
      ))}
    </div>
  )
}
