import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { MENU_PANEL_CLASS } from './Popover'

type IconType = ComponentType<{ width?: number; height?: number; className?: string }>

/**
 * A menu opened at a cursor point — shadcn's DropdownMenu, anchored to a
 * zero-size point at (x, y) instead of a trigger element, so it flips and
 * clamps to the viewport like every other menu. Mounted while open; any
 * dismissal (Escape, a press outside, a resize) calls `onClose`. Content is
 * plain MenuItem rows, plus ContextMenuSub flyouts.
 */
export default function ContextMenu({
  x,
  y,
  onClose,
  children,
  width = 220,
}: {
  x: number
  y: number
  onClose: () => void
  children: ReactNode
  width?: number
}) {
  return (
    <DropdownMenu open modal={false} onOpenChange={(open) => !open && onClose()}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none fixed size-0" style={{ left: x, top: y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={0}
        style={{ width }}
        className={cn(MENU_PANEL_CLASS, 'p-1')}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
        // Focus stays where it was: this opens from a right-click, not a key.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A row that opens a flyout to its side (shadcn DropdownMenuSub). Works inside
 * a ContextMenu; inside a Popover action menu it needs a DropdownMenu around it.
 */
export function ContextMenuSub({
  label,
  icon: Icon,
  disabled = false,
  width = 200,
  children,
}: {
  label: ReactNode
  icon?: IconType
  disabled?: boolean
  width?: number
  children: ReactNode
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        disabled={disabled}
        className="gap-2.5 rounded px-2.5 py-1.5 text-[12px] text-muted-foreground data-[state=open]:text-foreground"
      >
        {Icon && <Icon width={14} height={14} />}
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent style={{ width }} className={cn(MENU_PANEL_CLASS, 'p-1')}>
        {children}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
