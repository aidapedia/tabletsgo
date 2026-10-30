import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Hover tooltip shared across the app. Wraps a single trigger element.
 *
 *   <Tooltip label="Refresh" placement="bottom">
 *     <button>…</button>
 *   </Tooltip>
 *
 * Rendered in a portal with fixed positioning so it's never clipped by an
 * ancestor's `overflow` and always paints above other UI. `placement`:
 * top | bottom | left | right — flipped to the other side when that one would
 * leave the viewport, and nudged inward so it is never cut off.
 * `wrapperClassName` lets the wrapper inherit layout utilities (flex-1, etc.).
 */
const GAP = 8
// The closest a tooltip may sit to the viewport edge.
const EDGE = 8

const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

// Top-left corner of a `w`×`h` tooltip placed on `side` of the trigger.
function place(rect, side, w, h) {
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  switch (side) {
    case 'top':
      return { left: cx - w / 2, top: rect.top - GAP - h }
    case 'bottom':
      return { left: cx - w / 2, top: rect.bottom + GAP }
    case 'left':
      return { left: rect.left - GAP - w, top: cy - h / 2 }
    case 'right':
    default:
      return { left: rect.right + GAP, top: cy - h / 2 }
  }
}

const fits = (p, w, h) =>
  p.left >= EDGE && p.top >= EDGE && p.left + w <= window.innerWidth - EDGE && p.top + h <= window.innerHeight - EDGE

const clamp = (v, max) => Math.max(EDGE, Math.min(v, max - EDGE))

// Keep the tooltip on screen: flip to the opposite side when the asked one
// overflows (and the opposite doesn't), then slide it along the edge so a
// trigger near a corner never cuts it off.
function position(rect, placement, w, h) {
  let p = place(rect, placement, w, h)
  if (!fits(p, w, h)) {
    const flipped = place(rect, OPPOSITE[placement] ?? 'left', w, h)
    if (fits(flipped, w, h)) p = flipped
  }
  return {
    left: clamp(p.left, window.innerWidth - w),
    top: clamp(p.top, window.innerHeight - h),
  }
}

export default function Tooltip({ label, placement = 'top', multiline = false, children, wrapperClassName = '' }) {
  const triggerRef = useRef(null)
  const tipRef = useRef(null)
  const [show, setShow] = useState(false)
  // Null until the tooltip has been measured — it renders hidden for that one pass.
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    if (!show) {
      setPos(null)
      return
    }
    if (!triggerRef.current || !tipRef.current) return
    const { width, height } = tipRef.current.getBoundingClientRect()
    setPos(position(triggerRef.current.getBoundingClientRect(), placement, width, height))
  }, [show, placement, label])

  if (!label) return children

  return (
    <span
      ref={triggerRef}
      className={`relative inline-flex ${wrapperClassName}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocusCapture={() => setShow(true)}
      onBlurCapture={() => setShow(false)}
    >
      {children}
      {show &&
        createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
            className={`pointer-events-none fixed z-[200] rounded-soft border border-edge-strong bg-elevated px-2.5 py-1.5 text-[11px] font-medium text-ink ${
              multiline ? 'max-w-[280px] whitespace-pre-wrap break-words text-left' : 'whitespace-nowrap'
            }`}
          >
            {label}
          </span>,
          // Follow the fullscreened element when one is active — a tooltip on
          // <body> wouldn't paint over a fullscreen view (see Popover).
          document.fullscreenElement ?? document.body
        )}
    </span>
  )
}
