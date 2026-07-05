import { useEffect, useMemo, useState } from 'react'
import { getBackupCalendar } from '@/features/backup/lib/api'
import type { BackupCalendarDay } from '@/features/backup/lib/types'

const WEEKS = 53
const DAY_MS = 86400000
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Sequential single-hue ramp for "N successful runs that day" (magnitude).
// A failure is a status, not a magnitude, so it gets its own reserved color
// rather than a step on the green ramp — it always wins over the run count.
const LEVEL_CLASS = ['bg-elevated', 'bg-green/25', 'bg-green/50', 'bg-green/75', 'bg-green-bright']
const FAILED_CLASS = 'bg-red/70'

const levelFor = (success: number) => (success <= 0 ? 0 : success >= 4 ? 4 : success)

// GitHub-contributions-style calendar: 53 weeks x 7 days, day-index arithmetic
// throughout (never local-timezone Date math) so grid keys line up exactly
// with the server's UTC `date(started_at/1000, 'unixepoch')` aggregation.
export default function BackupCalendarHeatmap({ connectionId }: { connectionId: string }) {
  const [days, setDays] = useState<BackupCalendarDay[]>([])

  useEffect(() => {
    let alive = true
    getBackupCalendar(connectionId).then((d) => alive && setDays(d))
    return () => {
      alive = false
    }
  }, [connectionId])

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
      <div className="mb-1 text-[13px] font-bold">Backup activity</div>
      <div className="overflow-x-auto">
        <div className="mt-3 flex w-max gap-[3px]">
          {columns.map((col, i) => {
            const showMonth = i === 0 || col[0].date.getUTCMonth() !== columns[i - 1][0].date.getUTCMonth()
            return (
              <div key={i} className="flex flex-col gap-[3px]">
                <div className="h-3 text-[9px] whitespace-nowrap text-ink-faint">{showMonth ? MONTH_LABELS[col[0].date.getUTCMonth()] : ''}</div>
                {col.map((cell) => {
                  const future = cell.idx > cell.todayIdx
                  const entry = byDay.get(cell.key)
                  const cls = future ? 'bg-transparent' : entry?.failed ? FAILED_CLASS : LEVEL_CLASS[levelFor(entry?.success || 0)]
                  const title = future ? undefined : entry ? `${cell.key} — ${entry.runs} run${entry.runs === 1 ? '' : 's'} (${entry.success} success, ${entry.failed} failed)` : `${cell.key} — no backup`
                  return <div key={cell.key} title={title} className={`h-3 w-3 rounded-[2px] ${cls}`} />
                })}
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-ink-faint">
        <span>Less</span>
        {LEVEL_CLASS.map((c, i) => (
          <span key={i} className={`h-3 w-3 rounded-[2px] ${c}`} />
        ))}
        <span>More</span>
        <span className="ml-4 flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-[2px] ${FAILED_CLASS}`} /> Had a failure
        </span>
      </div>
    </div>
  )
}
