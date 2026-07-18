import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import useDismiss from './useDismiss'

// Shared panel shell — every dropdown/action menu in the app (this Popover's
// panel, and the mouse-anchored ContextMenu) renders on this same surface.
export const MENU_PANEL_CLASS =
  'rounded-soft border border-edge-strong bg-card'

/**
 * Anchored popover. `trigger` is a render-prop receiving { open, toggle }.
 * `children` can be a node or a render-prop receiving { close }.
 *
 * `portal` renders the panel into <body> with fixed positioning so it can
 * escape an ancestor's `overflow-hidden`/clipping (e.g. inside a modal). It
 * flips above the trigger when there isn't room below.
 *
 * `keepMounted` keeps the panel (and its children) mounted even while closed,
 * toggling visibility with CSS instead of adding/removing it from the tree.
 * Use this when a child owns state/effects that must keep running while
 * closed — e.g. a filter panel that resolves its options and applies a
 * default value on load, not only once the user opens it.
 */
export default function Popover({
  trigger,
  children,
  align = 'left',
  placement = 'bottom',
  width = 300,
  panelClassName = '',
  portal = false,
  keepMounted = false,
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const panelRef = useRef(null)
  const [pos, setPos] = useState(null)

  useDismiss([ref, panelRef], () => setOpen(false), open)

  // Measure the trigger and place the fixed panel (portal mode only).
  useLayoutEffect(() => {
    if (!open || !portal) return
    const place = () => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      const gap = 6
      const panelH = panelRef.current?.offsetHeight ?? 0
      const spaceBelow = window.innerHeight - r.bottom
      const spaceAbove = r.top
      // Prefer the requested side, but flip when it can't fit and the other
      // side has more room — so a trigger near either screen edge stays visible.
      const preferTop = placement === 'top'
      const fitsPreferred = (preferTop ? spaceAbove : spaceBelow) >= panelH + gap
      const flip = preferTop
        ? (fitsPreferred || spaceAbove >= spaceBelow)
        : !(fitsPreferred || spaceBelow >= spaceAbove)
      setPos({
        left: align === 'right' ? Math.max(8, r.right - width) : Math.min(r.left, window.innerWidth - width - 8),
        top: flip ? undefined : r.bottom + gap,
        bottom: flip ? window.innerHeight - r.top + gap : undefined,
      })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, portal, align, placement, width])

  const close = () => setOpen(false)
  const content = typeof children === 'function' ? children({ close }) : children

  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}

      {(open || keepMounted) && portal &&
        createPortal(
          <div
            ref={panelRef}
            className={`fixed z-[100] ${MENU_PANEL_CLASS} ${panelClassName} ${open ? '' : 'hidden'}`}
            style={{ width, left: pos?.left, top: pos?.top, bottom: pos?.bottom, visibility: pos ? 'visible' : 'hidden' }}
          >
            {content}
          </div>,
          document.body
        )}

      {(open || keepMounted) && !portal && (
        <div
          ref={panelRef}
          className={`absolute z-50 ${MENU_PANEL_CLASS} ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} ${panelClassName} ${open ? '' : 'hidden'}`}
          style={{ width }}
        >
          {content}
        </div>
      )}
    </div>
  )
}
