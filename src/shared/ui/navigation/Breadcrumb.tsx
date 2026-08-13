import type { ReactNode } from 'react'

/**
 * The trail that says where you are: root → … → here.
 *
 * One component for every path a user can be standing in — the header of a
 * detail/form page, a node's ancestors in the resource tree, the location a
 * dialog is about to write into. Anything that draws its own `name / name /
 * name` line is drawing this one differently by accident.
 *
 * The last crumb is the place you are, so it renders as text even if it was
 * given an `onClick` — a breadcrumb never links to the page you are on.
 */
export type Crumb = {
  /** Stable key. Falls back to the position when omitted. */
  id?: string
  label: ReactNode
  /** Drawn left of the label (a `NodeIcon`, a db logo, …). */
  icon?: ReactNode
  /** What clicking it goes to. Omit for a segment that isn't navigable. */
  onClick?: () => void
  /** A segment that exists but has no value yet ("new group") — faint, italic. */
  placeholder?: boolean
}

const SIZE = {
  xs: 'text-[11px] gap-x-1 gap-y-0.5',
  sm: 'text-xs gap-x-1.5 gap-y-1',
}

export default function Breadcrumb({
  items,
  size = 'xs',
  separator = '/',
  className = '',
}: {
  items: Crumb[]
  size?: keyof typeof SIZE
  separator?: ReactNode
  className?: string
}) {
  if (items.length === 0) return null
  const lastIndex = items.length - 1

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className={`flex flex-wrap items-center ${SIZE[size]}`}>
        {items.map((item, i) => {
          const current = i === lastIndex
          const inner = (
            <>
              {item.icon}
              <span className="truncate">{item.label}</span>
            </>
          )
          const shape = 'flex min-w-0 items-center gap-1.5'
          return (
            <li key={item.id ?? i} className="flex min-w-0 items-center gap-1">
              {current || !item.onClick ? (
                <span
                  aria-current={current ? 'page' : undefined}
                  className={`${shape} ${item.placeholder ? 'italic text-ink-faint' : current ? 'text-ink-dim' : 'text-ink-faint'}`}
                >
                  {inner}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={item.onClick}
                  className={`${shape} text-ink-faint transition-colors hover:text-ink hover:underline`}
                >
                  {inner}
                </button>
              )}
              {!current && (
                <span aria-hidden className="shrink-0 text-ink-faint opacity-50">
                  {separator}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
