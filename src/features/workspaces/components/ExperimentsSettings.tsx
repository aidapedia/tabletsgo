import { useState } from 'react'
import { useToast } from '@/shared/ui/feedback/Toast'
import Toggle from '@/shared/ui/form/Toggle'
import { useWorkspaces, updateWorkspace } from '@/features/workspaces'
import { EXPERIMENTS } from '@/features/workspaces/experiments'

// Per-workspace beta feature flags. Any member sees the current state (it
// gates what they see, e.g. the S3/Backup nav item); only admins can toggle it.
export default function ExperimentsSettings() {
  const toast = useToast()
  const { current, refresh } = useWorkspaces()
  const [saving, setSaving] = useState<string | null>(null)

  if (!current) return <div className="text-xs text-ink-faint">Loading…</div>
  const isAdmin = current.role === 'admin'

  const toggle = async (key: string, next: boolean) => {
    setSaving(key)
    try {
      await updateWorkspace(current.id, { experiments: { [key]: next } })
      await refresh()
      toast.success(next ? 'Experiment enabled.' : 'Experiment disabled.')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-ink-dim">
        Early-access features for this workspace. They may change or be removed without notice.
        {!isAdmin && ' Only workspace admins can turn these on or off.'}
      </p>
      {EXPERIMENTS.map((exp) => {
        const enabled = !!current.experiments?.[exp.key]
        return (
          <div key={exp.key} className="flex items-center justify-between gap-4 rounded-card border border-edge bg-card p-4">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold">{exp.label}</div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">{exp.description}</p>
            </div>
            <Toggle
              checked={enabled}
              onChange={(next) => toggle(exp.key, next)}
              disabled={!isAdmin || saving === exp.key}
              ariaLabel={exp.label}
            />
          </div>
        )
      })}
    </div>
  )
}
