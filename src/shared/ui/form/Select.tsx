import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from '@/shared/ui/icons'

const MENU_MAX_H = 240
const MENU_GAP = 6

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
 *   portal     render the menu into <body> with fixed positioning, so it can
 *              escape an ancestor that clips it — notably DataTable's
 *              `overflow-x-auto`, which otherwise cuts the menu off inside a
 *              table cell. Same escape hatch (and the same reason) as Popover's
 *              `portal`.
 */
export default function Select({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  className = '',
  disabled = false,
  portal = false,
}) {
  const [open, setOpen] = useState(false)
  const [dropUp, setDropUp] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  // Portal mode only: the measured viewport box for the fixed menu.
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const menuRef = useRef(null)

  // Flip the menu to whichever side has room: above the box when it would run
  // past the bottom of the viewport, right-aligned when it would run past the
  // right edge. Alignment never changes the menu's own width, so measuring it
  // here can't feed back into the next measurement.
  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const place = () => {
      const r = ref.current.getBoundingClientRect()
      const below = window.innerHeight - r.bottom - MENU_GAP
      const above = r.top - MENU_GAP
      setDropUp(below < Math.min(MENU_MAX_H, above) && above > below)

      const menuW = menuRef.current?.offsetWidth ?? r.width
      const roomRight = window.innerWidth - r.left
      const roomLeft = r.right
      const right = menuW > roomRight && roomLeft > roomRight
      setAlignRight(right)

      if (portal) {
        const up = below < Math.min(MENU_MAX_H, above) && above > below
        setPos({
          left: right ? Math.max(8, r.right - menuW) : Math.min(r.left, window.innerWidth - menuW - 8),
          top: up ? undefined : r.bottom + MENU_GAP,
          bottom: up ? window.innerHeight - r.top + MENU_GAP : undefined,
          minWidth: r.width,
        })
      }
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, portal])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      const inBox = ref.current?.contains(e.target)
      // A portaled menu isn't a DOM descendant of the box, so it has to be
      // checked separately — otherwise mousedown closes it and the option's
      // click never lands.
      const inMenu = menuRef.current?.contains(e.target)
      if (!inBox && !inMenu) setOpen(false)
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

  // One menu, rendered either in flow (absolute, positioned by the classes) or
  // portaled to <body> (fixed, positioned by the measured `pos`). z-[100] in
  // portal mode matches Popover, so it clears modals and sticky chrome.
  const menu = (
    <div
      ref={menuRef}
      role="listbox"
      className={
        portal
          ? 'fixed z-[100] max-h-[240px] w-max max-w-[280px] overflow-y-auto rounded-soft border border-edge-strong bg-elevated p-1'
          : `absolute z-50 max-h-[240px] w-max min-w-full max-w-[280px] overflow-y-auto rounded-soft border border-edge-strong bg-elevated p-1 ${
              dropUp ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
            } ${alignRight ? 'right-0' : 'left-0'}`
      }
      // Hidden until measured, so it never flashes at the top-left corner.
      style={portal ? { ...pos, visibility: pos ? 'visible' : 'hidden' } : undefined}
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
  )

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

      {open && (portal ? createPortal(menu, document.fullscreenElement ?? document.body) : menu)}
    </div>
  )
}
