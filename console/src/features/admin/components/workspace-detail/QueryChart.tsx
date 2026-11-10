import { useState } from 'react'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import type { AdminWorkspaceOverview } from '../../api'
import { formatCount } from './ui'

type Days = AdminWorkspaceOverview['queries']['days']

const PLOT_HEIGHT = 180

// The server buckets by UTC day, so a label has to be read back in UTC too.
const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })

const compact = new Intl.NumberFormat(undefined, { notation: 'compact' })

// The smallest round number at or above `n`, so the top gridline means something.
function niceMax(n: number) {
  if (n <= 4) return 4
  const scale = 10 ** Math.floor(Math.log10(n))
  return [1, 2, 2.5, 5, 10].map((m) => m * scale).find((m) => m >= n) as number
}

/** Queries per day. One series, so the title names it and no legend is needed. */
export default function QueryChart({ days }: { days: Days }) {
  const [hover, setHover] = useState<number | null>(null)
  const top = Math.max(...days.map((d) => d.total))
  if (!top) return <EmptyState>No queries in the last 30 days.</EmptyState>

  const max = niceMax(top)
  const last = days.length - 1
  const peak = days.reduce((best, d) => (d.total > best.total ? d : best), days[0])
  const hovered = hover === null ? null : days[hover]

  return (
    <>
      <p className="-mt-2 mb-3 text-[12px] text-muted-foreground">
        Peak {formatCount(peak.total)} on {dayLabel(peak.day)}
      </p>
      <div className="flex gap-2">
        <div className="relative w-[34px] shrink-0 text-right text-[11px] text-muted-foreground" style={{ height: PLOT_HEIGHT }} aria-hidden>
          {[1, 0.5, 0].map((f) => (
            <span key={f} className="absolute right-0 translate-y-1/2" style={{ bottom: `${f * 100}%` }}>
              {compact.format(max * f)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height: PLOT_HEIGHT }}>
            {[1, 0.5, 0].map((f) => (
              <div key={f} className={`absolute inset-x-0 border-t ${f ? 'border-border' : 'border-input'}`} style={{ bottom: `${f * 100}%` }} aria-hidden />
            ))}
            <div className="absolute inset-0 flex items-stretch">
              {days.map((d, i) => (
                <button
                  key={d.day}
                  type="button"
                  aria-label={`${dayLabel(d.day)}: ${d.total} queries, ${d.failed} failed`}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className={`flex min-w-0 flex-1 cursor-default items-end justify-center px-px ${hover === i ? 'bg-accent' : ''}`}
                >
                  <span
                    className={`block w-full max-w-4 rounded-t ${
                      i === last ? 'bg-input' : hover === i ? 'bg-primary-bright' : 'bg-primary'
                    }`}
                    style={{ height: `${(d.total / max) * 100}%` }}
                  />
                </button>
              ))}
            </div>
            {hovered && (
              <div
                className="pointer-events-none absolute -top-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg border border-input bg-muted px-2.5 py-2 text-[12px]"
                style={{ left: `${Math.min(90, Math.max(10, (((hover as number) + 0.5) / days.length) * 100))}%` }}
              >
                <div className="font-semibold">{hover === last ? 'Today, so far' : dayLabel(hovered.day)}</div>
                <div className="mt-0.5 text-muted-foreground">
                  {formatCount(hovered.total)} queries · {formatCount(hovered.failed)} failed
                </div>
              </div>
            )}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-muted-foreground" aria-hidden>
            {[0, 7, 14, 21].map((i) => (
              <span key={i}>{dayLabel(days[i].day)}</span>
            ))}
            <span>Today</span>
          </div>
        </div>
      </div>
    </>
  )
}
