import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, SearchIcon } from '@/shared/ui/icons'

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
 *   options    [{ value, label, hint?, keywords? }] — `hint` is dimmed second
 *              line in the menu, `keywords` extra text the search matches on
 *   placeholder shown when no option matches the value
 *   className  styling for the box
 *   disabled
 *   searchable filter box at the top of the menu — for lists long enough that
 *              scanning them is work (people, tables). Matches label, hint and
 *              keywords, so a person can be found by name *or* email.
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
  searchable = false,
  searchPlaceholder = 'Search…',
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [dropUp, setDropUp] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  // Portal mode only: the measured viewport box for the fixed menu.
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const menuRef = useRef(null)
  const searchRef = useRef(null)

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

  // The query is per-opening: reopening a select shouldn't resume someone
  // else's half-typed filter.
  useEffect(() => {
    if (!open) setQuery('')
    else if (searchable) searchRef.current?.focus()
  }, [open, searchable])

  const toggle = () => !disabled && setOpen((o) => !o)
  const selected = options.find((o) => o.value === value)

  const q = query.trim().toLowerCase()
  const shown = useMemo(
    () =>
      q
        ? options.filter((o) =>
            [o.label, o.hint, o.keywords].some((t) => String(t ?? '').toLowerCase().includes(q))
          )
        : options,
    [options, q]
  )

  // One menu, rendered either in flow (absolute, positioned by the classes) or
  // portaled to <body> (fixed, positioned by the measured `pos`). z-[100] in
  // portal mode matches Popover, so it clears modals and sticky chrome.
  // The scroll lives on the option list, not the menu box — otherwise a
  // `searchable` menu scrolls its own filter box out of view.
  const menu = (
    <div
      ref={menuRef}
      className={
        portal
          ? 'fixed z-[100] flex w-max max-w-[280px] flex-col rounded-soft border border-edge-strong bg-elevated p-1'
          : `absolute z-50 flex w-max min-w-full max-w-[280px] flex-col rounded-soft border border-edge-strong bg-elevated p-1 ${
              dropUp ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
            } ${alignRight ? 'right-0' : 'left-0'}`
      }
      // Hidden until measured, so it never flashes at the top-left corner.
      style={portal ? { ...pos, visibility: pos ? 'visible' : 'hidden' } : undefined}
      // In non-portal mode the menu sits inside the box, whose onClick toggles
      // the menu shut — which would make the filter box unclickable.
      onClick={(e) => e.stopPropagation()}
    >
      {searchable && (
        <div className="relative mb-1 shrink-0">
          <SearchIcon
            width={13}
            height={13}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            // Enter/space are the box's open/close keys; inside the field they
            // are just typing. Stopping propagation also keeps the event from
            // reaching the window-level Escape listener, so Escape closes here.
            // Enter takes the top match — and must be swallowed either way, or
            // it submits the surrounding <form> (the menu is inside it).
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'Enter') {
                e.preventDefault()
                if (shown.length) {
                  onChange(shown[0].value)
                  setOpen(false)
                }
              }
            }}
            className="w-full rounded border border-edge bg-panel py-1.5 pl-7 pr-2 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-edge-strong"
          />
        </div>
      )}
      <div role="listbox" className="max-h-[240px] min-h-0 overflow-y-auto">
      {shown.length === 0 && (
        <div className="px-2.5 py-3 text-center text-[11px] text-ink-faint">No matches.</div>
      )}
      {shown.map((o) => {
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
            <span className="min-w-0 flex-1">
              <span className="block truncate">{o.label}</span>
              {o.hint && <span className="block truncate text-[10px] text-ink-faint">{o.hint}</span>}
            </span>
            {active && <span className="shrink-0 text-green">✓</span>}
          </button>
        )
      })}
      </div>
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
