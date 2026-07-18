import { useRef, type ReactNode } from 'react'
import useDismiss from '@/shared/ui/overlay/useDismiss'
import Button from '@/shared/ui/buttons/Button'
import { CheckIcon, CloseIcon } from '@/shared/ui/icons'

// Generic, presentational multi-step wizard in a centered modal. It owns no
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
  const panel = useRef<HTMLDivElement>(null)
  // Esc/outside-press closes — but never mid-action, so a running apply/backup
  // can't be abandoned by a stray click.
  useDismiss([panel], () => !busy && onClose(), true)

  return (
    <div className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]">
      <div
        ref={panel}
        className="flex max-h-[85vh] w-full max-w-[560px] animate-pop flex-col rounded-[16px] border border-edge-strong bg-panel"
      >
        {/* Header: title + close */}
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <h3 className="text-sm font-bold text-ink">{title}</h3>
          <button
            onClick={() => !busy && onClose()}
            disabled={busy}
            aria-label="Close"
            className="text-ink-faint transition-colors hover:text-ink disabled:opacity-40"
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
                        ? 'bg-green text-white'
                        : active
                          ? 'bg-green/15 text-green-bright ring-1 ring-green'
                          : 'bg-edge text-ink-faint'
                    }`}
                  >
                    {done ? <CheckIcon width={11} height={11} /> : i + 1}
                  </span>
                  <span className={`whitespace-nowrap text-[11px] ${active ? 'font-semibold text-ink' : 'text-ink-faint'}`}>
                    {step.title}
                  </span>
                </div>
                {i < steps.length - 1 && <span className={`h-px flex-1 ${done ? 'bg-green/50' : 'bg-edge'}`} />}
              </div>
            )
          })}
        </div>

        {/* Active step body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 border-t border-edge px-5 py-4">
          <div>
            {onBack && (
              <Button variant="subtle" size="sm" onClick={onBack} disabled={busy}>
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!hideCancel && (
              <Button variant="subtle" size="sm" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
            )}
            {onNext && (
              <Button variant="primary" size="sm" onClick={onNext} disabled={nextDisabled || busy}>
                {busy ? 'Working…' : nextLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
