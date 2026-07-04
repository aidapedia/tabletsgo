import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react'

type IconType = ComponentType<{ width?: number; height?: number; className?: string }>

/**
 * Full-width sidebar navigation row (primary nav, left-rail sections).
 * Bigger and bolder than `MenuItem`, which is for dropdown/context menus.
 * Props: active, icon, badge (e.g. "Soon"), plus button attributes.
 */
type NavItemProps = {
  active?: boolean
  icon?: IconType
  badge?: ReactNode
  className?: string
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

export default function NavItem({ active = false, icon: Icon, badge, className = '', children, ...props }: NavItemProps) {
  return (
    <button
      className={`flex w-full items-center gap-2.5 rounded-soft px-2.5 py-2 text-left text-[13px] transition-colors ${
        active ? 'bg-card-hover font-semibold text-ink' : 'text-ink-dim hover:bg-card-hover hover:text-ink'
      } ${className}`}
      {...props}
    >
      {Icon && <Icon width={16} height={16} className={active ? 'text-green' : ''} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {badge && (
        <span className="rounded-[5px] border border-edge bg-elevated px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-ink-faint">
          {badge}
        </span>
      )}
    </button>
  )
}
