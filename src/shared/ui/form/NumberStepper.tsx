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
  placeholder,
  autoFocus,
  allowNull = false,
  id,
}: {
  value: number | null
  onChange: (n: number | null) => void
  min?: number
  max?: number
  step?: number
  ariaLabel?: string
  className?: string
  placeholder?: string
  autoFocus?: boolean
  // Blurring an emptied field commits null instead of reverting to the last value.
  allowNull?: boolean
  id?: string
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  useEffect(() => setDraft(value == null ? '' : String(value)), [value])

  const clamp = (n: number) => Math.min(Math.max(n, min), max)

  const commit = () => {
    if (draft.trim() === '') {
      if (allowNull) onChange(null)
      return
    }
    const n = parseFloat(draft)
    const next = Number.isFinite(n) ? clamp(n) : (value ?? 0)
    onChange(next)
    setDraft(String(next))
  }

  const bump = (delta: number) => {
    const n = parseFloat(draft)
    const next = clamp((Number.isFinite(n) ? n : (value ?? 0)) + delta)
    onChange(next)
    setDraft(String(next))
  }

  return (
    <div
      className={`flex items-stretch overflow-hidden rounded-soft border border-edge bg-elevated transition-[border-color,box-shadow] duration-150 focus-within:border-green-dim focus-within:shadow-[0_0_0_3px_rgba(111,207,106,0.22)] ${className}`}
    >
      <input
        id={id}
        type="number"
        min={Number.isFinite(min) ? min : undefined}
        max={Number.isFinite(max) ? max : undefined}
        value={draft}
        placeholder={placeholder}
        autoFocus={autoFocus}
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
        className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[11px] text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <div className="flex w-7 shrink-0 flex-col border-l border-edge">
        <button
          type="button"
          aria-label={ariaLabel ? `Increase ${ariaLabel}` : 'Increase'}
          onClick={() => bump(step)}
          disabled={value != null && value >= max}
          className="flex flex-1 items-center justify-center text-ink-dim transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronDown width={13} height={13} className="rotate-180" />
        </button>
        <button
          type="button"
          aria-label={ariaLabel ? `Decrease ${ariaLabel}` : 'Decrease'}
          onClick={() => bump(-step)}
          disabled={value != null && value <= min}
          className="flex flex-1 items-center justify-center border-t border-edge text-ink-dim transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronDown width={13} height={13} />
        </button>
      </div>
    </div>
  )
}
