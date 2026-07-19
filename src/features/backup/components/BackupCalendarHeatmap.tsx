import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { getBackupCalendar } from '@/features/backup/lib/api'
import type { BackupCalendarDay } from '@/features/backup/lib/types'

const WEEKS = 53
const DAY_MS = 86400000
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// One color for "backed up that day" — a failure is a status, not a
// magnitude, so it gets its own reserved color and always wins over a count.
// A day with both a success and a failure gets its own mixed color rather
// than being folded into either bucket.
const HAS_BACKUP_CLASS = 'bg-green-bright'
const FAILED_CLASS = 'bg-red/70'
const MIXED_CLASS = 'bg-amber'

// GitHub-contributions-style calendar: 53 weeks x 7 days, day-index arithmetic
// throughout (never local-timezone Date math) so grid keys line up exactly
// with the server's UTC `date(started_at/1000, 'unixepoch')` aggregation.
export default function BackupCalendarHeatmap({
  connectionId,
  selectedDay,
  onDayClick,
  days: daysProp,
  summary,
}: {
  connectionId: string
  selectedDay?: string | null
  onDayClick?: (day: string) => void
  // Pre-fetched calendar; when provided the component won't fetch its own (lets
  // a parent share one fetch between the heatmap and its own stat computations).
  days?: BackupCalendarDay[]
  // Optional panel rendered to the right of the grid (e.g. a "Today" summary).
  summary?: ReactNode
}) {
  const [fetched, setFetched] = useState<BackupCalendarDay[]>([])
  const days = daysProp ?? fetched

  useEffect(() => {
    if (daysProp) return
    let alive = true
    getBackupCalendar(connectionId).then((d) => alive && setFetched(d))
    return () => {
      alive = false
    }
  }, [connectionId, daysProp])

  const byDay = useMemo(() => new Map(days.map((d) => [d.day, d])), [days])

  const columns = useMemo(() => {
    const todayIdx = Math.floor(Date.now() / DAY_MS)
    const todayDow = new Date(todayIdx * DAY_MS).getUTCDay() // 0 = Sunday
    const endIdx = todayIdx + (6 - todayDow) // this week's Saturday
    const startIdx = endIdx - WEEKS * 7 + 1 // Sunday, WEEKS weeks back

    return Array.from({ length: WEEKS }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => {
        const idx = startIdx + w * 7 + d
        const date = new Date(idx * DAY_MS)
        return { idx, todayIdx, date, key: date.toISOString().slice(0, 10) }
      })
    )
  }, [])

  return (
    <div className="rounded-card border border-edge bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[13px] font-bold">Backup activity</div>
        <span className="rounded-[6px] border border-edge bg-elevated px-2 py-1 text-[10px] text-ink-faint">Last 365 days</span>
      </div>
      <div className="flex gap-5">
        <div className="min-w-0 flex-1">
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}>
        {columns.map((col, i) => {
          const showMonth = i === 0 || col[0].date.getUTCMonth() !== columns[i - 1][0].date.getUTCMonth()
          return (
            <div key={i} className="flex flex-col gap-[3px]">
              <div className="h-3 text-[9px] whitespace-nowrap text-ink-faint">{showMonth ? MONTH_LABELS[col[0].date.getUTCMonth()] : ''}</div>
              {col.map((cell) => {
                const future = cell.idx > cell.todayIdx
                const entry = byDay.get(cell.key)
                const cls = future
                  ? 'bg-transparent'
                  : entry?.success && entry?.failed
                    ? MIXED_CLASS
                    : entry?.failed
                      ? FAILED_CLASS
                      : entry?.success
                        ? HAS_BACKUP_CLASS
                        : 'bg-elevated'
                const title = future ? undefined : entry ? `${cell.key} — ${entry.runs} run${entry.runs === 1 ? '' : 's'} (${entry.success} success, ${entry.failed} failed)` : `${cell.key} — no backup`
                const selected = selectedDay === cell.key
                return (
                  <button
                    key={cell.key}
                    type="button"
                    title={title}
                    disabled={future || !onDayClick}
                    onClick={() => onDayClick?.(cell.key)}
                    className={`aspect-square w-full rounded-[2px] ${cls} ${
                      selected ? 'ring-2 ring-offset-1 ring-offset-card ring-ink' : ''
                    } ${!future && onDayClick ? 'cursor-pointer' : ''}`}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-ink-faint">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[2px] bg-elevated" /> No backups
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-[2px] ${HAS_BACKUP_CLASS}`} /> Backed up
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-[2px] ${MIXED_CLASS}`} /> Success &amp; failed
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-[2px] ${FAILED_CLASS}`} /> Had a failure
        </span>
      </div>
        </div>
        {summary && <div className="hidden w-[168px] shrink-0 border-l border-edge pl-5 lg:block">{summary}</div>}
      </div>
    </div>
  )
}
