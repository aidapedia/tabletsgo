import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Progress } from '@/shared/ui/progress'
import { CheckIcon, CloseIcon } from '@/shared/ui/icons'
import { cn } from '@/shared/lib/utils'

export type Step = { label: string; hint: string; done: boolean; action?: { label: string; run: () => void } }

const dismissKey = (workspaceId: string) => `tabletsgo:home:getting-started:${workspaceId}`

function readDismissed(workspaceId: string) {
  try {
    return localStorage.getItem(dismissKey(workspaceId)) === '1'
  } catch {
    return false
  }
}

/**
 * A short checklist for a workspace that is still being set up. Each step is
 * worked out from what the workspace already holds, so it ticks itself — there
 * is nothing to mark done by hand. Hidden once every step is done, or when the
 * person closes it (remembered per workspace, in this browser only).
 */
export default function GettingStarted({ workspaceId, steps }: { workspaceId: string; steps: Step[] }) {
  const [dismissed, setDismissed] = useState(() => readDismissed(workspaceId))
  const done = steps.filter((s) => s.done).length
  if (dismissed || done === steps.length) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(dismissKey(workspaceId), '1')
    } catch {
      /* private mode — it just comes back next visit */
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[13px] font-semibold">Set up your workspace</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {done} of {steps.length} done
          </p>
        </div>
        <Button variant="ghost" size="icon-xs" onClick={dismiss} aria-label="Hide setup checklist">
          <CloseIcon width={12} height={12} />
        </Button>
      </div>
      <Progress value={(done / steps.length) * 100} className="mt-3 h-1" />

      <ol className="mt-3 grid grid-cols-4 gap-2 max-[1000px]:grid-cols-2 max-[560px]:grid-cols-1">
        {steps.map((step) => (
          <li
            key={step.label}
            className={cn('flex flex-col rounded-lg border border-border p-3', step.done && 'bg-muted/40')}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border',
                  step.done ? 'border-success bg-success text-background' : 'border-input'
                )}
              >
                {step.done && <CheckIcon width={10} height={10} />}
              </span>
              <span className={cn('text-[12px] font-medium', step.done && 'text-muted-foreground line-through')}>
                {step.label}
              </span>
            </div>
            <p className="mt-1 flex-1 text-[11px] text-faint">{step.hint}</p>
            {!step.done && step.action && (
              <Button variant="outline" size="sm" onClick={step.action.run} className="mt-2.5 self-start">
                {step.action.label}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
