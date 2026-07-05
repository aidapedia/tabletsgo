import { useEffect, useRef, useState } from 'react'

/**
 * Anchored popover. `trigger` is a render-prop receiving { open, toggle }.
 * `children` can be a node or a render-prop receiving { close }.
 */
export default function Popover({ trigger, children, align = 'left', placement = 'bottom', width = 300, panelClassName = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
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

  const close = () => setOpen(false)

  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={`absolute z-50 rounded-soft border border-edge-strong bg-elevated shadow-[0_16px_40px_-12px_rgba(0,0,0,0.8)] ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} ${panelClassName}`}
          style={{ width }}
        >
          {typeof children === 'function' ? children({ close }) : children}
        </div>
      )}
    </div>
  )
}
