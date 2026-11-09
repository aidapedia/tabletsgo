import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * A row inside a dropdown / context menu (workspace switcher, connection
 * actions, saved-query and object menus, ERD export list). Full-width,
 * left-aligned, optional leading icon passed as children.
 * Props: danger (red text for destructive actions), active (pinned selected
 * look, e.g. current connection in a picker list), plus button attributes.
 */
type MenuItemProps = {
  danger?: boolean
  active?: boolean
  className?: string
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

export default function MenuItem({ danger = false, active = false, className = '', children, ...props }: MenuItemProps) {
  return (
    <button
      className={`flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
        active
          ? 'bg-accent text-foreground'
          : danger
            ? 'text-destructive hover:bg-accent hover:!text-destructive'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
