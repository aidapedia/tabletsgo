import { useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import Badge from '@/shared/ui/Badge'
import { useToast } from '@/shared/ui/feedback/Toast'
import { GridIcon, WandIcon, WorkflowIcon } from '@/shared/ui/icons'
import { TYPE_LABEL } from '@/features/connections'
import { applyTemplate } from '../lib/apply'
import type { ApplyResult } from '../lib/apply'
import type { Template } from '../types'

// Main-area tab content for a single template (opened from TemplatesPanel).
// Shows what applying will create and an Apply button. Apply is gated on the
// current connection's DB type — incompatible templates are browsable but not
// appliable.
export default function TemplateDetailView({
  template,
  connectionId,
  dbType,
  onApplied,
}: {
  template: Template
  connectionId: string
  dbType: string
  onApplied: (result: ApplyResult) => void
}) {
  const toast = useToast()
  const [applying, setApplying] = useState(false)
  const supported = template.databases.includes(dbType as any)

  const apply = async () => {
    setApplying(true)
    try {
      const result = await applyTemplate(connectionId, template)
      onApplied(result)
      toast.success('Template applied')
    } catch (e: any) {
      toast.error(`Couldn't apply template: ${e.message}`)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-auto">
      <div className="mx-auto w-full max-w-[720px] p-8">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] border border-edge bg-elevated text-ink-dim">
            <WandIcon width={20} height={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{template.name}</h1>
              <div className="flex gap-1">
                {template.databases.map((d) => (
                  <Badge key={d} tone="neutral">
                    {TYPE_LABEL[d] ?? d}
                  </Badge>
                ))}
              </div>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">{template.description}</p>
          </div>
        </div>

        <div className="mt-8">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            This will create on this connection
          </div>
          <div className="mt-2.5 flex flex-col gap-1.5">
            {template.workflows.map((w) => (
              <div
                key={w.key}
                className="flex items-center gap-2.5 rounded-soft border border-edge bg-elevated/30 px-3.5 py-2.5 text-sm"
              >
                <WorkflowIcon className="shrink-0 text-ink-faint" width={15} height={15} />
                <span className="flex-1 truncate">{w.name}</span>
                <span className="text-[11px] text-ink-faint">Workflow</span>
                {w.runOnApply && <Badge tone="amber">Runs once on apply</Badge>}
              </div>
            ))}
            {template.dashboards.map((d) => {
              const widgetCount = Array.isArray((d.config as any)?.widgets) ? (d.config as any).widgets.length : 0
              return (
                <div
                  key={d.name}
                  className="flex items-center gap-2.5 rounded-soft border border-edge bg-elevated/30 px-3.5 py-2.5 text-sm"
                >
                  <GridIcon className="shrink-0 text-ink-faint" width={15} height={15} />
                  <span className="flex-1 truncate">{d.name}</span>
                  <span className="text-[11px] text-ink-faint">
                    Dashboard · {widgetCount} widget{widgetCount === 1 ? '' : 's'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-8 flex items-center gap-3">
          <Button variant="primary" size="lg" disabled={!supported || applying} onClick={apply}>
            {applying ? 'Applying…' : 'Apply template'}
          </Button>
          {!supported && (
            <span className="text-[12px] text-amber">Not available for {TYPE_LABEL[dbType] ?? dbType}.</span>
          )}
        </div>
      </div>
    </div>
  )
}
