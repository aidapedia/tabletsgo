import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'
import { CheckIcon, CloseIcon } from '@/shared/ui/icons'
import { Button } from '@/shared/ui/button'

// Generic, presentational multi-step wizard in a centered modal (shadcn Dialog). It owns no
// step logic — the caller supplies `steps`, the current `activeIndex`, the body
// for the active step (`children`), and the footer actions. Reuse it for any
// guided flow (updates, onboarding, imports, …).

export type WizardStep = { id: string; title: string }

export default function Wizard({
  title = 'Wizard',
  steps,
  activeIndex,
  children,
  onClose,
  onBack,
  onNext,
  nextLabel = 'Next',
  nextDisabled = false,
  busy = false,
  hideCancel = false,
}: {
  title?: string
  steps: WizardStep[]
  activeIndex: number
  children: ReactNode
  onClose: () => void
  onBack?: () => void
  onNext?: () => void
  nextLabel?: string
  nextDisabled?: boolean
  busy?: boolean
  hideCancel?: boolean
}) {
  // Esc/outside-press closes — but never mid-action, so a running apply/backup
  // can't be abandoned by a stray click.
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[560px]"
      >
        {/* Header: title + close */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <DialogTitle className="text-sm font-bold text-foreground">{title}</DialogTitle>
          <button
            onClick={() => !busy && onClose()}
            disabled={busy}
            aria-label="Close"
            className="text-faint transition-colors hover:text-foreground disabled:opacity-40"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 px-5 pt-4">
          {steps.map((step, i) => {
            const done = i < activeIndex
            const active = i === activeIndex
            return (
              <div key={step.id} className="flex flex-1 items-center gap-1 last:flex-none">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      done
                        ? 'bg-primary text-white'
                        : active
                          ? 'bg-primary/15 text-primary-bright ring-1 ring-primary'
                          : 'bg-border text-faint'
                    }`}
                  >
                    {done ? <CheckIcon width={11} height={11} /> : i + 1}
                  </span>
                  <span className={`whitespace-nowrap text-[11px] ${active ? 'font-semibold text-foreground' : 'text-faint'}`}>
                    {step.title}
                  </span>
                </div>
                {i < steps.length - 1 && <span className={`h-px flex-1 ${done ? 'bg-primary/50' : 'bg-border'}`} />}
              </div>
            )
          })}
        </div>

        {/* Active step body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-4">
          <div>
            {onBack && (
              <Button variant="ghost" size="sm" onClick={onBack} disabled={busy}>
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!hideCancel && (
              <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
            )}
            {onNext && (
              <Button variant="default" size="sm" onClick={onNext} disabled={nextDisabled || busy}>
                {busy ? 'Working…' : nextLabel}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
