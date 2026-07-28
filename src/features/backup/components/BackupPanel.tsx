import { useEffect, useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import Button from '@/shared/ui/buttons/Button'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CheckIcon, CloseIcon, CloudIcon, ClockIcon, PlayIcon, ShieldIcon, SettingsIcon } from '@/shared/ui/icons'
import { getBackupCalendar, getBackupSchedule, listBackupRuns, runBackupNow, updateBackupSchedule } from '@/features/backup/lib/api'
import type { BackupCalendarDay, BackupRun, BackupSchedule } from '@/features/backup/lib/types'
import BackupCalendarHeatmap from './BackupCalendarHeatmap'
import BackupVersionList from './BackupVersionList'
import RestorePanel from './RestorePanel'
import Toggle from '@/shared/ui/form/Toggle'
import LoadingState from '@/shared/ui/feedback/LoadingState'

// ---- small formatting helpers ----
const FREQ_LABEL = (s: BackupSchedule) =>
  s.frequency === 'daily' ? `Daily · ${String(s.hourOfDay).padStart(2, '0')}:00 UTC` : 'Every hour'

function relTime(ts?: number) {
  if (!ts) return '—'
  const mins = Math.round((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  const d = Math.round(hrs / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

// Next fire time for the schedule, in the viewer's locale (server fires on UTC
// hour boundaries — see the backup scheduler).
function nextRunLabel(s: BackupSchedule | null) {
  if (!s || !s.enabled) return 'Paused'
  const next = new Date()
  next.setUTCMinutes(0, 0, 0)
  if (s.frequency === 'hourly') {
    next.setUTCHours(next.getUTCHours() + 1)
    return next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  next.setUTCHours(s.hourOfDay)
  if (next <= new Date()) next.setUTCDate(next.getUTCDate() + 1)
  return next.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Backup tab: a read-only viewer. All configuration (create/edit the schedule)
// happens on the connection's Edit page → Backup tab (BackupConfigForm); this
// panel shows what's running (status + calendar + versions) with a context
// sidebar for the schedule summary and restore-from-file.
export default function BackupPanel({
  connectionId,
  connectionType,
  workspaceId,
  onConfigure,
}: {
  connectionId: string
  connectionType: string
  workspaceId: string
  onConfigure?: () => void
}) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [schedule, setSchedule] = useState<BackupSchedule | null>(null)
  const [days, setDays] = useState<BackupCalendarDay[]>([])
  const [lastRun, setLastRun] = useState<BackupRun | null>(null)
  const [toggling, setToggling] = useState(false)
  const [running, setRunning] = useState(false)
  const [dateFilter, setDateFilter] = useState<string | null>(null)

  const supported = connectionType === 'sqlite' || connectionType === 'postgresql'

  useEffect(() => {
    if (!supported) {
      setLoading(false)
      return
    }
    let alive = true
    Promise.all([getBackupSchedule(connectionId), getBackupCalendar(connectionId), listBackupRuns(connectionId, { limit: 1 })]).then(
      ([sched, cal, runsPage]) => {
        if (!alive) return
        setSchedule(sched)
        setDays(cal)
        setLastRun(runsPage.runs[0] || null)
        setLoading(false)
      }
    )
    return () => {
      alive = false
    }
  }, [connectionId, supported])

  const todayKey = new Date().toISOString().slice(0, 10)
  const totals = useMemo(() => {
    const acc = { runs: 0, success: 0, failed: 0 }
    let last30 = 0
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    for (const d of days) {
      acc.runs += d.runs
      acc.success += d.success
      acc.failed += d.failed
      if (d.day >= cutoff) last30 += d.failed
    }
    return { ...acc, failures30d: last30, today: days.find((d) => d.day === todayKey) }
  }, [days, todayKey])

  const toggleActive = async () => {
    if (!schedule) return
    setToggling(true)
    try {
      setSchedule(await updateBackupSchedule(connectionId, { enabled: !schedule.enabled }))
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setToggling(false)
    }
  }

  const runNow = async () => {
    setRunning(true)
    try {
      const res = await runBackupNow(connectionId)
      if (res.ok) {
        toast.success('Backup ran.')
        // Refresh the calendar + last-run so the UI reflects the new run.
        Promise.all([getBackupCalendar(connectionId), listBackupRuns(connectionId, { limit: 1 })]).then(([cal, runsPage]) => {
          setDays(cal)
          setLastRun(runsPage.runs[0] || null)
        })
      } else toast.error(res.error || 'Backup failed')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setRunning(false)
    }
  }

  if (loading) return <LoadingState className="py-16 text-center" />

  if (!supported) {
    return (
      <div className="rounded-card border border-dashed border-edge-strong py-16 text-center text-[13px] text-ink-dim">
        Backups aren't supported for this connection type yet — only SQLite and PostgreSQL are.
      </div>
    )
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      {/* Main column */}
      <div className="flex flex-col gap-5">
        {schedule && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={ClockIcon} tone="amber" label="Schedule" value={schedule.frequency === 'daily' ? 'Daily' : 'Hourly'} sub={`Next ${nextRunLabel(schedule)}`} />
            <StatCard icon={ShieldIcon} label="Retention" value={schedule.retentionDays > 0 ? `${schedule.retentionDays} days` : 'Forever'} sub={schedule.retentionDays > 0 ? 'Auto cleanup on' : 'Kept indefinitely'} />
            <StatCard icon={CloudIcon} label="Destinations" value={String(schedule.destinationIds.length)} sub={schedule.encrypt ? 'Encrypted · AES-256' : 'Not encrypted'} />
            <StatCard icon={ShieldIcon} tone={totals.failures30d > 0 ? 'red' : 'default'} label="Failures (30d)" value={String(totals.failures30d)} sub={`of ${totals.runs} total runs`} />
          </div>
        )}

        <BackupCalendarHeatmap
          connectionId={connectionId}
          days={days}
          selectedDay={dateFilter}
          onDayClick={(d) => setDateFilter((cur) => (cur === d ? null : d))}
          summary={<TodaySummary today={totals.today} totalRuns={totals.runs} totalSuccess={totals.success} totalFailed={totals.failed} />}
        />

        <BackupVersionList
          connectionId={connectionId}
          connectionType={connectionType}
          workspaceId={workspaceId}
          dateFilter={dateFilter}
          onClearDateFilter={() => setDateFilter(null)}
        />
      </div>

      {/* Context sidebar */}
      <aside className="flex flex-col gap-5">
        <ScheduleCard
          schedule={schedule}
          lastRun={lastRun}
          toggling={toggling}
          running={running}
          onToggle={toggleActive}
          onRunNow={runNow}
          onConfigure={onConfigure}
        />
        <RestorePanel connectionId={connectionId} workspaceId={workspaceId} />
      </aside>
    </div>
  )
}

// ---- a single stat tile in the main column ----
const STAT_TONE = {
  default: 'bg-elevated text-ink-dim',
  amber: 'bg-elevated text-amber',
  red: 'bg-elevated text-red',
}
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'default',
}: {
  icon: ComponentType<{ width?: number; height?: number }>
  label: string
  value: string
  sub?: string
  tone?: keyof typeof STAT_TONE
}) {
  return (
    <div className="rounded-card border border-edge bg-card p-4">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-[8px] ${STAT_TONE[tone]}`}>
          <Icon width={14} height={14} />
        </span>
        <span className="text-[11px] text-ink-dim">{label}</span>
      </div>
      <div className="mt-2.5 truncate text-[19px] font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-ink-faint">{sub}</div>}
    </div>
  )
}

// ---- "Today" summary rendered beside the activity heatmap ----
function TodaySummary({ today, totalRuns, totalSuccess, totalFailed }: { today?: BackupCalendarDay; totalRuns: number; totalSuccess: number; totalFailed: number }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[12px] font-bold">Today</div>
      <div className="flex flex-col gap-2 text-[12px]">
        <span className="flex items-center gap-2">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green/20 text-green-bright">
            <CheckIcon width={10} height={10} />
          </span>
          {today?.success || 0} backups
        </span>
        <span className="flex items-center gap-2">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red/20 text-red">
            <CloseIcon width={10} height={10} />
          </span>
          {today?.failed || 0} failed
        </span>
      </div>
      <div className="border-t border-edge pt-3">
        <div className="text-[10px] uppercase tracking-wide text-ink-faint">Last 365 days</div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-ink-dim">
          <span>Runs</span>
          <span className="font-semibold tabular-nums text-ink">{totalRuns}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-ink-dim">
          <span>Succeeded</span>
          <span className="font-semibold tabular-nums text-green-bright">{totalSuccess}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-ink-dim">
          <span>Failed</span>
          <span className="font-semibold tabular-nums text-ink">{totalFailed}</span>
        </div>
      </div>
    </div>
  )
}

// ---- Backup Schedule card (context sidebar) ----
function ScheduleRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-[12px] text-ink-dim">{label}</span>
      <span className="min-w-0 truncate text-right text-[12px] font-medium text-ink">{value}</span>
    </div>
  )
}

function ScheduleCard({
  schedule,
  lastRun,
  toggling,
  running,
  onToggle,
  onRunNow,
  onConfigure,
}: {
  schedule: BackupSchedule | null
  lastRun: BackupRun | null
  toggling: boolean
  running: boolean
  onToggle: () => void
  onRunNow: () => void
  onConfigure?: () => void
}) {
  if (!schedule) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-card border border-dashed border-edge-strong p-6 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-elevated text-amber">
          <ClockIcon width={18} height={18} />
        </span>
        <div className="text-[12px] text-ink-dim">No backup schedule yet — configure one to run automatic backups.</div>
        {onConfigure && (
          <Button variant="primary" size="sm" onClick={onConfigure}>
            Configure backup
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-card border border-edge bg-card p-5">
      <div className="flex items-center gap-2 text-[13px] font-bold">
        <ClockIcon width={15} height={15} /> Backup schedule
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-soft border border-edge bg-elevated px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold">{FREQ_LABEL(schedule)}</div>
          <div className="text-[11px] text-ink-faint">{schedule.enabled ? 'Active' : 'Paused'}</div>
        </div>
        <Toggle checked={schedule.enabled} onChange={onToggle} disabled={toggling} ariaLabel="Toggle backup schedule" />
      </div>

      <div className="mt-2 divide-y divide-edge">
        <ScheduleRow label="Next run" value={nextRunLabel(schedule)} />
        <ScheduleRow label="Last run" value={lastRun ? relTime(lastRun.startedAt) : 'Never'} />
        <ScheduleRow label="Retention" value={schedule.retentionDays > 0 ? `${schedule.retentionDays} days` : 'Forever'} />
        <ScheduleRow label="Destinations" value={`${schedule.destinationIds.length} destination${schedule.destinationIds.length === 1 ? '' : 's'}`} />
        <ScheduleRow
          label="Encryption"
          value={
            schedule.encrypt ? (
              <span className="inline-flex items-center gap-1 text-green-bright">
                <ShieldIcon width={11} height={11} /> AES-256
              </span>
            ) : (
              'Off'
            )
          }
        />
        <ScheduleRow label="Connection config" value={schedule.includeConfig ? 'Included' : 'Not included'} />
      </div>

      <div className="mt-4 flex gap-2">
        <Button variant="ghost" size="sm" className="flex-1" icon={PlayIcon} onClick={onRunNow} disabled={running}>
          {running ? 'Running…' : 'Run now'}
        </Button>
        {onConfigure && (
          <Button variant="subtle" size="sm" icon={SettingsIcon} onClick={onConfigure}>
            Configure
          </Button>
        )}
      </div>
    </div>
  )
}
