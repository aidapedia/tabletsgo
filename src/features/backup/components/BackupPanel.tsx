import { useEffect, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import { useToast } from '@/shared/ui/feedback/Toast'
import { ClockIcon } from '@/shared/ui/icons'
import { getBackupSchedule, runBackupNow, updateBackupSchedule } from '@/features/backup/lib/api'
import type { BackupSchedule } from '@/features/backup/lib/types'
import BackupCalendarHeatmap from './BackupCalendarHeatmap'
import BackupVersionList from './BackupVersionList'
import LoadingState from '@/shared/ui/feedback/LoadingState'

// Backup tab: a read-only viewer (status + calendar + version list). All
// configuration (create/edit the schedule) happens on the connection's Edit
// page → Backup tab (see BackupConfigForm) — this panel just shows what's
// running and lets you run it now or pause it.
export default function BackupPanel({ connectionId, connectionType, workspaceId, onConfigure }: { connectionId: string; connectionType: string; workspaceId: string; onConfigure?: () => void }) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [schedule, setSchedule] = useState<BackupSchedule | null>(null)
  const [toggling, setToggling] = useState(false)
  const [running, setRunning] = useState(false)
  const [dateFilter, setDateFilter] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getBackupSchedule(connectionId).then((sched) => {
      if (!alive) return
      setSchedule(sched)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [connectionId])

  const supported = connectionType === 'sqlite' || connectionType === 'postgresql'

  const toggleActive = async () => {
    if (!schedule) return
    setToggling(true)
    try {
      const next = await updateBackupSchedule(connectionId, { enabled: !schedule.enabled })
      setSchedule(next)
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
      if (res.ok) toast.success('Backup ran.')
      else toast.error(res.error || 'Backup failed')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setRunning(false)
    }
  }

  if (loading) return <LoadingState className="" />

  if (!supported) {
    return (
      <div className="rounded-card border border-dashed border-edge-strong py-16 text-center text-[13px] text-ink-dim">
        Backups aren't supported for this connection type yet — only SQLite and PostgreSQL are.
      </div>
    )
  }

  if (!schedule) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-card border border-dashed border-edge-strong py-16 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-elevated text-amber">
          <ClockIcon width={18} height={18} />
        </span>
        <div className="text-[13px] text-ink-dim">
          No backup schedule yet — configure one to run automatic backups.
        </div>
        {onConfigure && (
          <Button variant="primary" size="sm" onClick={onConfigure}>
            Configure backup
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between rounded-card border border-edge bg-card p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-elevated text-amber">
            <ClockIcon width={18} height={18} />
          </span>
          <div>
            <div className="text-[13px] font-bold">
              {schedule.frequency === 'daily' ? `Daily at ${String(schedule.hourOfDay).padStart(2, '0')}:00 UTC` : 'Every hour'}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-faint">
              {schedule.destinationIds.length} destination{schedule.destinationIds.length === 1 ? '' : 's'}
              {schedule.retryLimit > 0 && ` · retry up to ${schedule.retryLimit}×`}
              {schedule.retentionDays > 0 && ` · ${schedule.retentionDays}d retention`}
              {schedule.encrypt && ' · encrypted'}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={runNow} disabled={running}>
            {running ? 'Running…' : 'Run now'}
          </Button>
          <Button
            variant={schedule.enabled ? 'ghost' : 'primary'}
            size="sm"
            className={schedule.enabled ? '!text-green-bright' : ''}
            onClick={toggleActive}
            disabled={toggling}
          >
            {schedule.enabled ? 'Active' : 'Paused'}
          </Button>
        </div>
      </div>

      <BackupCalendarHeatmap connectionId={connectionId} selectedDay={dateFilter} onDayClick={(d) => setDateFilter((cur) => (cur === d ? null : d))} />
      <BackupVersionList
        connectionId={connectionId}
        connectionType={connectionType}
        workspaceId={workspaceId}
        dateFilter={dateFilter}
        onClearDateFilter={() => setDateFilter(null)}
      />
    </div>
  )
}
