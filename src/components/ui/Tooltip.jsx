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
 * top | bottom | left | right. `wrapperClassName` lets the wrapper inherit
 * layout utilities (flex-1, etc.).
 */
const GAP = 8

// Offset the tooltip from the anchor point by its own size per placement.
const TRANSFORM = {
  top: 'translate(-50%, -100%)',
  bottom: 'translate(-50%, 0)',
  left: 'translate(-100%, -50%)',
  right: 'translate(0, -50%)',
}

function anchorFor(rect, placement) {
  switch (placement) {
    case 'top':
      return { left: rect.left + rect.width / 2, top: rect.top - GAP }
    case 'bottom':
      return { left: rect.left + rect.width / 2, top: rect.bottom + GAP }
    case 'left':
      return { left: rect.left - GAP, top: rect.top + rect.height / 2 }
    case 'right':
    default:
      return { left: rect.right + GAP, top: rect.top + rect.height / 2 }
  }
}

export default function Tooltip({ label, placement = 'top', multiline = false, children, wrapperClassName = '' }) {
  const triggerRef = useRef(null)
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  useLayoutEffect(() => {
    if (!show || !triggerRef.current) return
    setPos(anchorFor(triggerRef.current.getBoundingClientRect(), placement))
  }, [show, placement])

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
            role="tooltip"
            style={{ left: pos.left, top: pos.top, transform: TRANSFORM[placement] }}
            className={`pointer-events-none fixed z-[200] rounded-soft border border-edge-strong bg-elevated px-2.5 py-1.5 text-[11px] font-medium text-ink shadow-[0_12px_34px_-10px_rgba(0,0,0,0.75)] ${
              multiline ? 'max-w-[280px] whitespace-pre-wrap break-words text-left' : 'whitespace-nowrap'
            }`}
          >
            {label}
          </span>,
          document.body
        )}
    </span>
  )
}
