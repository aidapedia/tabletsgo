import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentType, ReactNode } from 'react'

type IconType = ComponentType<{ width?: number; height?: number; className?: string }>

/**
 * Full-width sidebar navigation row (primary nav, left-rail sections).
 * Bigger and bolder than `MenuItem`, which is for dropdown/context menus.
 *
 * Pass `href` when the row leads to a route: it then renders a real `<a>`, so
 * the destination shows on hover and cmd/middle-click opens a new tab. The
 * caller still intercepts the plain click for SPA navigation. Without `href`
 * it stays a `<button>`.
 *
 * Props: active, icon, badge (e.g. "Soon"), href, plus element attributes.
 */
type NavItemProps = {
  active?: boolean
  icon?: IconType
  badge?: ReactNode
  href?: string
  className?: string
  children?: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement> & AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>

export default function NavItem({ active = false, icon: Icon, badge, href, className = '', children, ...props }: NavItemProps) {
  const classes = `flex w-full items-center gap-2.5 rounded-soft px-2.5 py-2 text-left text-[13px] transition-colors ${
    active ? 'bg-card-hover font-semibold text-ink' : 'text-ink-dim hover:bg-card-hover hover:text-ink'
  } ${className}`

  const body = (
    <>
      {Icon && <Icon width={16} height={16} className={active ? 'text-green' : ''} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {badge && (
        <span className="rounded-[5px] border border-edge bg-elevated px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-ink-faint">
          {badge}
        </span>
      )}
    </>
  )

  if (href) {
    return (
      <a href={href} aria-current={active ? 'page' : undefined} className={classes} {...props}>
        {body}
      </a>
    )
  }

  return (
    <button className={classes} {...props}>
      {body}
    </button>
  )
}
