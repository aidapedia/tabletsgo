import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from '@/shared/ui/icons'

/**
 * Themed select to replace native <select>.
 * - Small chevron inset from the right edge (no oversized browser glyph).
 * - Dropdown styled like the app's popup modals.
 *
 * Drop-in for a styled <select>: `className` is applied to the box itself
 * (so width / flex / border / padding utilities carry over).
 *
 * Props:
 *   value      current value
 *   onChange   (value) => void   — receives the raw value (not an event)
 *   options    [{ value, label }]
 *   placeholder shown when no option matches the value
 *   className  styling for the box
 *   disabled
 */
export default function Select({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  className = '',
  disabled = false,
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    // Capture phase: some containers (e.g. the slide-over panels) stop mousedown
    // propagation, which would prevent a bubble-phase listener from ever firing.
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => !disabled && setOpen((o) => !o)
  const selected = options.find((o) => o.value === value)

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          toggle()
        }
      }}
      className={`relative flex cursor-pointer items-center justify-between gap-1.5 ${
        disabled ? 'cursor-not-allowed opacity-50' : ''
      } ${className}`}
    >
      <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-ink-faint'}`}>
        {selected ? selected.label : placeholder}
      </span>
      <ChevronDown
        width={13}
        height={13}
        className={`shrink-0 text-ink-faint transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
      />

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-[calc(100%+6px)] z-50 max-h-[240px] w-max min-w-full max-w-[280px] overflow-y-auto rounded-soft border border-edge-strong bg-elevated p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.8)]"
        >
          {options.map((o) => {
            const active = o.value === value
            return (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={active}
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(o.value)
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                  active ? 'bg-green/15 text-green-bright' : 'text-ink-dim hover:bg-card-hover hover:text-ink'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {active && <span className="shrink-0 text-green">✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
