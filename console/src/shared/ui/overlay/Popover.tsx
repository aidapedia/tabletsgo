import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'
import { Popover as PopoverRoot, PopoverAnchor, PopoverContent } from '@/shared/ui/popover'

// Shared panel surface — every dropdown/action menu in the app (this Popover's
// panel, and the mouse-anchored ContextMenu) renders on this same look.
export const MENU_PANEL_CLASS = 'rounded-lg border border-input bg-card p-0 text-foreground shadow-none ring-0'

type PopoverProps = {
  /** Render-prop for the anchor; it owns its own click (`toggle`). */
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode
  /** A node, or a render-prop receiving `close` for a panel that closes itself. */
  children: ReactNode | ((api: { close: () => void }) => ReactNode)
  align?: 'left' | 'right' | 'start'
  placement?: 'bottom' | 'top'
  width?: number
  panelClassName?: string
  /** Accepted for old call sites; the panel always portals now. */
  portal?: boolean
  /**
   * Keep the panel (and its children) mounted while closed, hidden with CSS —
   * for a child that owns effects that must keep running (a filter panel that
   * applies a default on load, not only once opened).
   */
  keepMounted?: boolean
}

/**
 * An anchored panel on shadcn's Popover (Radix): it portals, flips to the side
 * with room, and closes on Escape or a press outside. The render-prop API stays
 * because triggers style themselves from `open` and panels hand `close` on to
 * their own controls (`onApply={close}`).
 */
export default function Popover({
  trigger,
  children,
  align = 'left',
  placement = 'bottom',
  width = 300,
  panelClassName,
  keepMounted = false,
}: PopoverProps) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)
  const content = typeof children === 'function' ? children({ close }) : children

  return (
    <PopoverRoot open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative" ref={anchor}>
          {trigger({ open, toggle: () => setOpen((o) => !o) })}
        </div>
      </PopoverAnchor>
      <PopoverContent
        side={placement}
        align={align === 'right' ? 'end' : 'start'}
        sideOffset={6}
        forceMount={keepMounted || undefined}
        style={{ width }}
        className={cn(MENU_PANEL_CLASS, 'gap-0', keepMounted && !open && 'hidden', panelClassName)}
        // The trigger toggles itself; a press on it is not "outside".
        onInteractOutside={(e) => {
          if (anchor.current?.contains(e.target as Node)) e.preventDefault()
        }}
      >
        {content}
      </PopoverContent>
    </PopoverRoot>
  )
}
