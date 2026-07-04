import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * A row inside a dropdown / context menu (workspace switcher, connection
 * actions, saved-query and object menus, ERD export list). Full-width,
 * left-aligned, optional leading icon passed as children.
 * Props: danger (red hover for destructive actions), active (pinned selected
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
        active ? 'bg-card-hover text-ink' : 'text-ink-dim hover:bg-card-hover hover:text-ink'
      } ${danger ? 'hover:!text-red' : ''} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
