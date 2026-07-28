import { useEffect, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import Select from '@/shared/ui/form/Select'
import CheckboxRow from '@/shared/ui/form/CheckboxRow'
import Toggle from '@/shared/ui/form/Toggle'
import NumberStepper from '@/shared/ui/form/NumberStepper'
import { controlClass } from '@/shared/ui/form/Input'
import { FormField } from '@/shared/ui/form/Form'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CloudIcon, MonitorIcon } from '@/shared/ui/icons'
import { toggleId } from '@/shared/lib/toggleId'
import { createBackupSchedule, getBackupSchedule, listStorages, updateBackupSchedule } from '@/features/backup/lib/api'
import type { BackupSchedulePayload } from '@/features/backup/lib/api'
import type { StorageDestination } from '@/features/backup/lib/types'
import LoadingState from '@/shared/ui/feedback/LoadingState'

// Reserved id (matches the server) for the always-available destination that
// stores backups on the server's own disk — the default when no S3 storage is set up.
const LOCAL_STORAGE_ID = 'local'

const FREQUENCIES = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
]
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00 UTC` }))
const RETRY_LIMIT_OPTIONS = [
  { value: 0, label: 'No retry' },
  { value: 1, label: '1 attempt' },
  { value: 2, label: '2 attempts' },
  { value: 3, label: '3 attempts' },
  { value: 5, label: '5 attempts' },
]
const RETRY_DELAY_OPTIONS = [
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
  { value: 900, label: '15 minutes' },
  { value: 1800, label: '30 minutes' },
  { value: 3600, label: '1 hour' },
]

type ConfigState = {
  frequency: 'hourly' | 'daily'
  hourOfDay: number
  destinationIds: string[]
  retryLimit: number
  retryDelaySec: number
  retentionDays: number
  encrypt: boolean
  includeConfig: boolean
  enabled: boolean
}

const DEFAULT_CONFIG: ConfigState = {
  frequency: 'hourly',
  hourOfDay: 0,
  destinationIds: [LOCAL_STORAGE_ID],
  retryLimit: 0,
  retryDelaySec: 60,
  retentionDays: 0,
  encrypt: false,
  includeConfig: false,
  enabled: true,
}

// Full backup-schedule editor: frequency/destinations/retry/retention/
// encryption/active. Fetches the connection's current schedule itself and
// decides create-vs-update on Save — this is the *only* place a schedule can
// be created or reconfigured (the Backup detail tab is a read-only viewer).
export default function BackupConfigForm({
  connectionId,
  connectionType,
  workspaceId,
}: {
  connectionId: string
  connectionType: string
  workspaceId: string
}) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [exists, setExists] = useState(false)
  const [storages, setStorages] = useState<StorageDestination[]>([])
  const [config, setConfig] = useState<ConfigState>(DEFAULT_CONFIG)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([getBackupSchedule(connectionId), listStorages(workspaceId)]).then(([sched, list]) => {
      if (!alive) return
      setStorages(list)
      if (sched) {
        setExists(true)
        setConfig({
          frequency: sched.frequency,
          hourOfDay: sched.hourOfDay,
          destinationIds: sched.destinationIds,
          retryLimit: sched.retryLimit,
          retryDelaySec: sched.retryDelaySec,
          retentionDays: sched.retentionDays,
          encrypt: sched.encrypt,
          includeConfig: sched.includeConfig,
          enabled: sched.enabled,
        })
      }
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [connectionId, workspaceId])

  const supported = connectionType === 'sqlite' || connectionType === 'postgresql'
  const patch = (p: Partial<ConfigState>) => setConfig((c) => ({ ...c, ...p }))
  const toggleDest = (id: string) => patch({ destinationIds: toggleId(config.destinationIds, id) })

  const save = async () => {
    if (!config.destinationIds.length) return
    setSaving(true)
    try {
      if (exists) {
        await updateBackupSchedule(connectionId, config as BackupSchedulePayload)
      } else {
        await createBackupSchedule(connectionId, config as BackupSchedulePayload)
        setExists(true)
      }
      toast.success('Backup schedule saved.')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!supported) {
    return (
      <div className="rounded-card border border-dashed border-edge-strong py-16 text-center text-[13px] text-ink-dim">
        Backups aren't supported for this connection type yet — only SQLite and PostgreSQL are.
      </div>
    )
  }
  if (loading) return <LoadingState className="" />

  return (
    <div className="flex flex-col gap-4">
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-soft border border-edge bg-elevated/40 px-3 py-2.5">
        <div>
          <div className="text-[12px] font-medium text-ink">Active</div>
          <p className="mt-0.5 text-[11px] text-ink-faint">Runs automatically on the schedule below. Turn off to pause without losing the config.</p>
        </div>
        <Toggle checked={config.enabled} onChange={(v) => patch({ enabled: v })} ariaLabel="Active" />
      </label>

      <div className="grid grid-cols-2 gap-3.5">
        <FormField label="Frequency">
          <Select className={controlClass} value={config.frequency} options={FREQUENCIES} onChange={(v) => patch({ frequency: v })} />
        </FormField>
        {config.frequency === 'daily' && (
          <FormField label="Time of day">
            <Select className={controlClass} value={config.hourOfDay} options={HOUR_OPTIONS} onChange={(v) => patch({ hourOfDay: v })} />
          </FormField>
        )}
      </div>

      <div>
        <div className="mb-2 text-[12px] font-medium text-ink">Destinations</div>
        <div className="flex flex-col gap-2">
          <CheckboxRow
            checked={config.destinationIds.includes(LOCAL_STORAGE_ID)}
            onChange={() => toggleDest(LOCAL_STORAGE_ID)}
            ariaLabel="Local server disk"
          >
            <MonitorIcon width={14} height={14} className="shrink-0 text-ink-dim" />
            <span className="min-w-0 flex-1 truncate text-[12px]">Local server disk</span>
            <span className="shrink-0 text-[10px] text-ink-faint">on this server</span>
          </CheckboxRow>
          {storages.map((s) => (
            <CheckboxRow key={s.id} checked={config.destinationIds.includes(s.id)} onChange={() => toggleDest(s.id)} ariaLabel={s.name}>
              <CloudIcon width={14} height={14} className="shrink-0 text-sky-400" />
              <span className="min-w-0 flex-1 truncate text-[12px]">{s.name}</span>
              <span className="shrink-0 text-[10px] text-ink-faint">{s.bucket}</span>
            </CheckboxRow>
          ))}
        </div>
        {storages.length === 0 && (
          <p className="mt-2 text-[11px] text-ink-faint">
            Backups store on this server by default. Add an S3-compatible destination in Workspace → Integrations to also keep copies off-server.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <FormField label="Retry on failure" hint="Extra attempts if a run fails, before giving up.">
          <Select className={controlClass} value={config.retryLimit} options={RETRY_LIMIT_OPTIONS} onChange={(v) => patch({ retryLimit: v })} />
        </FormField>
        {config.retryLimit > 0 && (
          <FormField label="Delay between attempts">
            <Select className={controlClass} value={config.retryDelaySec} options={RETRY_DELAY_OPTIONS} onChange={(v) => patch({ retryDelaySec: v })} />
          </FormField>
        )}
      </div>

      <FormField
        label="Retention (days)"
        hint={
          config.retentionDays > 0
            ? `Backups older than ${config.retentionDays} day${config.retentionDays === 1 ? '' : 's'} are permanently deleted from storage after each run.`
            : '0 = keep every backup forever.'
        }
      >
        <NumberStepper value={config.retentionDays} onChange={(n) => patch({ retentionDays: n })} min={0} max={3650} ariaLabel="retention days" />
      </FormField>

      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-soft border border-edge bg-elevated/40 px-3 py-2.5">
        <div>
          <div className="text-[12px] font-medium text-ink">Encrypt before upload</div>
          <p className="mt-0.5 text-[11px] text-ink-faint">Encrypted with a server-managed key; restoring decrypts it automatically.</p>
        </div>
        <Toggle checked={config.encrypt} onChange={(v) => patch({ encrypt: v })} ariaLabel="Encrypt before upload" />
      </label>

      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-soft border border-edge bg-elevated/40 px-3 py-2.5">
        <div>
          <div className="text-[12px] font-medium text-ink">Include connection configuration</div>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            Ships a <code>.connection.json</code> next to each dump — settings, folders, saved queries, workflows and
            dashboards — so a lost connection can be rebuilt with Import. The password is never included.
          </p>
        </div>
        <Toggle checked={config.includeConfig} onChange={(v) => patch({ includeConfig: v })} ariaLabel="Include connection configuration" />
      </label>

      <Button variant="primary" size="sm" className="self-start" onClick={save} disabled={!config.destinationIds.length || saving}>
        {saving ? 'Saving…' : exists ? 'Save changes' : 'Create backup schedule'}
      </Button>
    </div>
  )
}
