import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Shared panel shell — every dropdown/action menu in the app (this Popover's
// panel, and the mouse-anchored ContextMenu) renders on this same surface.
export const MENU_PANEL_CLASS =
  'rounded-soft border border-edge-strong bg-elevated shadow-[0_16px_40px_-12px_rgba(0,0,0,0.8)]'

/**
 * Anchored popover. `trigger` is a render-prop receiving { open, toggle }.
 * `children` can be a node or a render-prop receiving { close }.
 *
 * `portal` renders the panel into <body> with fixed positioning so it can
 * escape an ancestor's `overflow-hidden`/clipping (e.g. inside a modal). It
 * flips above the trigger when there isn't room below.
 */
export default function Popover({ trigger, children, align = 'left', placement = 'bottom', width = 300, panelClassName = '', portal = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const panelRef = useRef(null)
  const [pos, setPos] = useState(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (ref.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    // Capture phase so we still hear the click even when a child (e.g. the React
    // Flow canvas) stops propagation before it reaches window.
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

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

      {open && portal &&
        createPortal(
          <div
            ref={panelRef}
            className={`fixed z-[100] ${MENU_PANEL_CLASS} ${panelClassName}`}
            style={{ width, left: pos?.left, top: pos?.top, bottom: pos?.bottom, visibility: pos ? 'visible' : 'hidden' }}
          >
            {content}
          </div>,
          document.body
        )}

      {open && !portal && (
        <div
          ref={panelRef}
          className={`absolute z-50 ${MENU_PANEL_CLASS} ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} ${panelClassName}`}
          style={{ width }}
        >
          {content}
        </div>
      )}
    </div>
  )
}
