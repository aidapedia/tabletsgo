import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MENU_PANEL_CLASS } from './Popover'
import useDismiss from './useDismiss'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import { ChevronRight } from '@/shared/ui/icons'

// Which ContextMenuSub is expanded, owned by the parent menu so that only one
// flyout exists at a time. Subs can't track this themselves: closing is delayed
// (to forgive a cursor that cuts a corner on its way to the flyout) while
// opening is immediate, so sibling-local state leaves the old flyout on screen
// underneath the new one for the length of the delay.
const OpenSubContext = createContext(null)

/**
 * Mouse-anchored sibling of Popover — same panel shell (MENU_PANEL_CLASS),
 * positioned at a cursor coordinate instead of a trigger element, with
 * submenu support via ContextMenuSub. Content is plain MenuItem rows.
 */
export default function ContextMenu({ x, y, onClose, children, width = 220 }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [openSub, setOpenSub] = useState(null)
  const sub = useMemo(() => ({ openSub, setOpenSub }), [openSub])

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
      <OpenSubContext.Provider value={sub}>{children}</OpenSubContext.Provider>
    </div>
  )
}

/**
 * A MenuItem row that opens a flyout panel to its side on hover. Inside a
 * ContextMenu the parent coordinates which sub is open; used standalone (e.g.
 * in a Popover action menu, where there are no siblings to coordinate with) it
 * falls back to its own state.
 */
export function ContextMenuSub({ label, icon: Icon, disabled = false, width = 200, children }) {
  const id = useId()
  const parent = useContext(OpenSubContext)
  const [localSub, setLocalSub] = useState(null)
  const { openSub, setOpenSub } = parent ?? { openSub: localSub, setOpenSub: setLocalSub }
  const open = openSub === id
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

  // Only ever close *this* sub — by the time the timer fires the cursor may
  // have opened a sibling, and that one must survive.
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpenSub((cur) => (cur === id ? null : cur)), 150)
  }
  const cancelClose = () => clearTimeout(closeTimer.current)

  return (
    <div ref={rowRef} onMouseEnter={() => !disabled && (cancelClose(), setOpenSub(id))} onMouseLeave={scheduleClose}>
      <MenuItem disabled={disabled} className="justify-between" onClick={() => !disabled && setOpenSub(open ? null : id)}>
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
