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
 * `collapsed` renders the icon-rail form: label and badge dropped. Pass `title`
 * alongside it so the row still names itself on hover — the label is the only
 * thing that told the user where it goes.
 *
 * Collapsed the row is a fixed 40x40 box — the same hit target as an
 * `IconButton` size="xl", which is what the console's `IconRail` uses — with
 * the icon centred inside it. Fixed size is what makes the centring safe *and*
 * exact: the box never inherits the width of an animating sidebar (so the icon
 * cannot snap to the middle of a 264px panel and lurch right), and the icon
 * sits dead centre whatever its intrinsic size, rather than relying on padding
 * to add up. The rail's own gutter then centres the box in the rail.
 *
 * Props: active, icon, badge (e.g. "Soon"), href, collapsed, plus element
 * attributes.
 */
type NavItemProps = {
  active?: boolean
  icon?: IconType
  badge?: ReactNode
  href?: string
  collapsed?: boolean
  className?: string
  children?: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement> & AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>

export default function NavItem({ active = false, icon: Icon, badge, href, collapsed = false, className = '', children, ...props }: NavItemProps) {
  const classes = `flex items-center rounded-soft py-2 text-left text-[13px] transition-colors ${
    collapsed ? 'h-10 w-10 justify-center' : 'w-full gap-2.5 px-2.5'
  } ${active ? 'bg-card-hover font-semibold text-ink' : 'text-ink-dim hover:bg-card-hover hover:text-ink'} ${className}`

  const body = (
    <>
      {Icon && <Icon width={16} height={16} className={`shrink-0 ${active ? 'text-green' : ''}`} />}
      {!collapsed && <span className="min-w-0 flex-1 truncate">{children}</span>}
      {!collapsed && badge && (
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
