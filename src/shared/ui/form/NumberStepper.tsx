import { useEffect, useState } from 'react'
import { ChevronDown } from '@/shared/ui/icons'

/**
 * Numeric input with up/down stepper buttons — draft text is kept in local
 * state and only clamped/committed on blur or Enter, so a leading zero or a
 * mid-edit value never gets stomped by a re-render on every keystroke (the
 * problem with binding a plain `<input type="number">` straight to numeric
 * state). `value`/`onChange` are the committed number; `min`/`max` clamp.
 */
export default function NumberStepper({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  ariaLabel,
  className = '',
}: {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
  ariaLabel?: string
  className?: string
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  const clamp = (n: number) => Math.min(Math.max(n, min), max)

  const commit = () => {
    const n = parseInt(draft, 10)
    const next = Number.isFinite(n) ? clamp(n) : value
    onChange(next)
    setDraft(String(next))
  }

  const bump = (delta: number) => {
    const n = parseInt(draft, 10)
    const next = clamp((Number.isFinite(n) ? n : value) + delta)
    onChange(next)
    setDraft(String(next))
  }

  return (
    <div className={`flex h-10 items-stretch overflow-hidden rounded-soft border border-edge bg-bg focus-within:border-green-dim ${className}`}>
      <input
        type="number"
        min={min}
        max={max}
        value={draft}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'ArrowUp') {
            e.preventDefault()
            bump(step)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            bump(-step)
          }
        }}
        className="min-w-0 flex-1 bg-transparent px-3 text-right text-[13px] text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <div className="flex w-7 shrink-0 flex-col border-l border-edge">
        <button
          type="button"
          aria-label={ariaLabel ? `Increase ${ariaLabel}` : 'Increase'}
          onClick={() => bump(step)}
          disabled={value >= max}
          className="flex flex-1 items-center justify-center text-ink-dim transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronDown width={13} height={13} className="rotate-180" />
        </button>
        <button
          type="button"
          aria-label={ariaLabel ? `Decrease ${ariaLabel}` : 'Decrease'}
          onClick={() => bump(-step)}
          disabled={value <= min}
          className="flex flex-1 items-center justify-center border-t border-edge text-ink-dim transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronDown width={13} height={13} />
        </button>
      </div>
    </div>
  )
}
