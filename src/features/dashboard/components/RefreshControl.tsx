import { useEffect, useState } from 'react'
import Popover from '@/shared/ui/overlay/Popover'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import IconButton from '@/shared/ui/buttons/IconButton'
import { ChevronDown, RefreshIcon } from '@/shared/ui/icons'

// Auto-refresh interval choices. `0` = off (manual refresh only).
export const REFRESH_INTERVALS: { ms: number; label: string }[] = [
  { ms: 0, label: 'Off' },
  { ms: 10_000, label: '10s' },
  { ms: 30_000, label: '30s' },
  { ms: 60_000, label: '1m' },
  { ms: 300_000, label: '5m' },
]

// Relative "updated Xs ago" label; coarse buckets are enough for a freshness hint.
function agoLabel(since: number, now: number): string {
  const s = Math.max(0, Math.round((now - since) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

// Split refresh control: click the icon to refresh now, the chevron to pick an
// auto-refresh interval. Shows how long ago the data was last refreshed and,
// when auto-refresh is on, the active interval.
export default function RefreshControl({
  onRefresh,
  intervalMs,
  onIntervalChange,
  lastRefreshedAt,
}: {
  onRefresh: () => void
  intervalMs: number
  onIntervalChange: (ms: number) => void
  lastRefreshedAt: number
}) {
  // Re-tick so the relative label stays current without a refresh.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(id)
  }, [])

  const active = REFRESH_INTERVALS.find((i) => i.ms === intervalMs)?.label

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center overflow-hidden rounded-[7px] border border-edge-strong">
        <Tooltip label={`Refresh · updated ${agoLabel(lastRefreshedAt, now)}`} placement="bottom">
          <button
            type="button"
            aria-label="Refresh all widgets"
            onClick={onRefresh}
            className="flex h-[26px] items-center px-2 text-ink-dim transition-colors hover:bg-elevated hover:text-ink"
          >
            <RefreshIcon width={15} height={15} />
          </button>
        </Tooltip>
        <div className="h-[26px] w-px bg-edge-strong" />
        <Popover
          portal
          align="left"
          width={120}
          trigger={({ open, toggle }) => (
            <button
              type="button"
              aria-label="Auto-refresh interval"
              onClick={toggle}
              className={`flex h-[26px] items-center gap-1 px-1.5 text-[11px] transition-colors hover:bg-elevated ${
                intervalMs > 0 ? 'font-semibold text-green-bright' : 'text-ink-faint'
              } ${open ? 'bg-elevated' : ''}`}
            >
              {intervalMs > 0 ? active : 'Auto'}
              <ChevronDown width={11} height={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          )}
        >
          {({ close }) => (
            <div className="p-1">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Auto-refresh</div>
              {REFRESH_INTERVALS.map((opt) => (
                <button
                  key={opt.ms}
                  type="button"
                  onClick={() => {
                    onIntervalChange(opt.ms)
                    close()
                  }}
                  className={`flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                    opt.ms === intervalMs ? 'bg-green/15 text-green-bright' : 'text-ink-dim hover:bg-card-hover hover:text-ink'
                  }`}
                >
                  {opt.label}
                  {opt.ms === intervalMs && <span className="text-green">✓</span>}
                </button>
              ))}
            </div>
          )}
        </Popover>
      </div>
      <span className="text-[10px] tabular-nums text-ink-faint">{agoLabel(lastRefreshedAt, now)}</span>
    </div>
  )
}
