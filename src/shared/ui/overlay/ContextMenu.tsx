import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MENU_PANEL_CLASS } from './Popover'
import useDismiss from './useDismiss'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import { ChevronRight } from '@/shared/ui/icons'

/**
 * Mouse-anchored sibling of Popover — same panel shell (MENU_PANEL_CLASS),
 * positioned at a cursor coordinate instead of a trigger element, with
 * submenu support via ContextMenuSub. Content is plain MenuItem rows.
 */
export default function ContextMenu({ x, y, onClose, children, width = 220 }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0
    setPos({
      left: Math.min(x, window.innerWidth - width - 8),
      top: Math.min(y, window.innerHeight - h - 8),
    })
  }, [x, y, width])

  useDismiss([ref], onClose)

  // Mouse-anchored, so a resize leaves it stranded away from its target.
  useEffect(() => {
    const close = () => onClose?.()
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [onClose])

  return (
    <div
      ref={ref}
      className={`fixed z-[70] p-1 ${MENU_PANEL_CLASS}`}
      style={{ left: pos.left, top: pos.top, width }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>
  )
}

/** A MenuItem row that opens a flyout panel to its side on hover. */
export function ContextMenuSub({ label, icon: Icon, disabled = false, width = 200, children }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const rowRef = useRef(null)
  const panelRef = useRef(null)
  const closeTimer = useRef(null)

  useLayoutEffect(() => {
    if (!open) return
    const rect = rowRef.current?.getBoundingClientRect()
    if (!rect) return
    const h = panelRef.current?.offsetHeight ?? 0
    setPos({
      left: Math.min(rect.right + 4, window.innerWidth - width - 8),
      top: Math.min(rect.top, window.innerHeight - h - 8),
    })
  }, [open, width])

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }
  const cancelClose = () => clearTimeout(closeTimer.current)

  return (
    <div ref={rowRef} onMouseEnter={() => !disabled && (cancelClose(), setOpen(true))} onMouseLeave={scheduleClose}>
      <MenuItem disabled={disabled} className="justify-between" onClick={() => !disabled && setOpen((o) => !o)}>
        <span className="flex items-center gap-2.5">
          {Icon && <Icon width={14} height={14} />}
          {label}
        </span>
        <ChevronRight width={14} height={14} className="text-ink-faint" />
      </MenuItem>
      {open && !disabled && (
        <div
          ref={panelRef}
          className={`fixed z-[71] p-1 ${MENU_PANEL_CLASS}`}
          style={{ left: pos.left, top: pos.top, width }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {children}
        </div>
      )}
    </div>
  )
}
