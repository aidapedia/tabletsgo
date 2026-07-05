import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@/shared/ui/buttons/Button'
import Select from '@/shared/ui/form/Select'
import Checkbox from '@/shared/ui/form/Checkbox'
import { controlClass } from '@/shared/ui/form/Input'
import { FormField } from '@/shared/ui/form/Form'
import { useToast } from '@/shared/ui/feedback/Toast'
import { ClockIcon, CloudIcon, ExternalLinkIcon } from '@/shared/ui/icons'
import { createBackupSchedule, getBackupSchedule, listStorages } from '@/features/backup/lib/api'
import { updateWorkflow, runWorkflow } from '@/features/workflow/lib/api'
import type { BackupSchedule, StorageDestination } from '@/features/backup/lib/types'
import BackupCalendarHeatmap from './BackupCalendarHeatmap'
import RestorePanel from './RestorePanel'

const FREQUENCIES = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
]
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00 UTC` }))

// Wizard (no schedule yet) → summary + calendar + restore (schedule exists).
// The schedule itself is just a workflow (Schedule → Export SQL → Store to
// Storage) created via POST .../backup-workflow; this panel is a guided front
// end for that workflow, not a separate system.
export default function BackupPanel({ connectionId, connectionName, connectionType, workspaceId }: any) {
  const navigate = useNavigate()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [schedule, setSchedule] = useState<BackupSchedule | null>(null)
  const [storages, setStorages] = useState<StorageDestination[]>([])
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)

  // Wizard form state (only used before a schedule exists).
  const [frequency, setFrequency] = useState<'hourly' | 'daily'>('hourly')
  const [hourOfDay, setHourOfDay] = useState(0)
  const [destinationIds, setDestinationIds] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    Promise.all([getBackupSchedule(connectionId), listStorages(workspaceId)]).then(([sched, list]) => {
      if (!alive) return
      setSchedule(sched)
      setStorages(list)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [connectionId, workspaceId])

  const supported = connectionType === 'sqlite' || connectionType === 'postgresql'
  const toggleDest = (id: string) => setDestinationIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const create = async () => {
    if (!destinationIds.length) return
    setSaving(true)
    try {
      await createBackupSchedule(connectionId, { frequency, hourOfDay, destinationIds })
      const sched = await getBackupSchedule(connectionId)
      setSchedule(sched)
      toast.success('Backup schedule created.')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async () => {
    if (!schedule) return
    setToggling(true)
    const next = !schedule.scheduleEnabled
    try {
      await updateWorkflow(connectionId, schedule.id, { scheduleEnabled: next })
      setSchedule((s) => (s ? { ...s, scheduleEnabled: next } : s))
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setToggling(false)
    }
  }

  const runNow = async () => {
    if (!schedule) return
    try {
      const res = await runWorkflow(connectionId, schedule.id)
      if (res.ok) toast.success('Backup ran.')
      else toast.error(res.error || 'Backup failed')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  if (loading) return <div className="text-xs text-ink-faint">Loading…</div>

  if (!supported) {
    return (
      <div className="rounded-card border border-dashed border-edge-strong py-16 text-center text-[13px] text-ink-dim">
        Backups aren't supported for this connection type yet — only SQLite and PostgreSQL are.
      </div>
    )
  }

  if (!schedule) {
    return (
      <div className="flex flex-col gap-5">
        <div className="rounded-card border border-edge bg-card p-5">
          <div className="mb-1 text-[13px] font-bold">Set up automated backups</div>
          <p className="mb-4 text-[12px] text-ink-dim">
            Creates a workflow — <span className="text-ink">Schedule → Export SQL → Store to Storage</span> — that dumps this
            connection and uploads it to the destinations you choose. It's a real, editable workflow, just protected from deletion.
          </p>

          <div className="grid grid-cols-2 gap-3.5">
            <FormField label="Frequency">
              <Select className={controlClass} value={frequency} options={FREQUENCIES} onChange={(v) => setFrequency(v)} />
            </FormField>
            {frequency === 'daily' && (
              <FormField label="Time of day">
                <Select className={controlClass} value={hourOfDay} options={HOUR_OPTIONS} onChange={(v) => setHourOfDay(v)} />
              </FormField>
            )}
          </div>

          <div className="mt-4">
            <div className="mb-2 text-[12px] font-medium text-ink">Destinations</div>
            {storages.length === 0 ? (
              <p className="text-[12px] text-ink-faint">
                No storage destinations yet —{' '}
                <button className="text-green-bright underline-offset-2 hover:underline" onClick={() => navigate('/workspace/integrations')}>
                  add one in Workspace → Integrations
                </button>{' '}
                first.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {storages.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2.5 rounded-soft border border-edge bg-elevated/40 px-3 py-2">
                    <Checkbox checked={destinationIds.includes(s.id)} onChange={() => toggleDest(s.id)} ariaLabel={s.name} />
                    <CloudIcon width={14} height={14} className="shrink-0 text-sky-400" />
                    <span className="min-w-0 flex-1 truncate text-[12px]">{s.name}</span>
                    <span className="shrink-0 text-[10px] text-ink-faint">{s.bucket}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <Button variant="primary" size="sm" className="mt-5" onClick={create} disabled={!destinationIds.length || saving}>
            {saving ? 'Creating…' : 'Create backup schedule'}
          </Button>
        </div>
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
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={runNow}>
            Run now
          </Button>
          <Button
            variant={schedule.scheduleEnabled ? 'ghost' : 'primary'}
            size="sm"
            className={schedule.scheduleEnabled ? '!text-green-bright' : ''}
            onClick={toggleActive}
            disabled={toggling}
          >
            {schedule.scheduleEnabled ? 'Active' : 'Paused'}
          </Button>
          <Button variant="ghost" size="sm" icon={ExternalLinkIcon} onClick={() => navigate(`/connection/${connectionId}`)}>
            Open workflow
          </Button>
        </div>
      </div>

      <BackupCalendarHeatmap connectionId={connectionId} />
      <RestorePanel connectionId={connectionId} connectionName={connectionName} workspaceId={workspaceId} />
    </div>
  )
}
