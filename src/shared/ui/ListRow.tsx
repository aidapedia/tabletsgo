import type { HTMLAttributes, ReactNode } from 'react'

/**
 * The standard clickable sidebar list row — one shared shape for the data
 * browser (tables/views/functions), schema drafts/releases, saved queries and
 * workflows. Owns the container styling and click target so the whole row is
 * clickable (not just its label) and the cursor stays consistent across the
 * icon, label and empty space. Compose the label with `RowLabel`.
 *
 * - `icon` renders first, `children` is the label area (kept flexible so callers
 *   can add inline badges/dots), `trailing` is the hover actions area (kebab)
 *   and is auto-wrapped so its clicks don't bubble up to the row's `onClick`.
 * - `active` swaps idle styling for the selected look.
 * - `onClick`, `draggable`, `title`, drag handlers, etc. pass straight through.
 */
type ListRowProps = {
  icon?: ReactNode
  active?: boolean
  trailing?: ReactNode
  className?: string
  children: ReactNode
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>

const base =
  'group flex w-full cursor-pointer items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-xs'
const idle = 'text-ink-dim hover:bg-elevated hover:text-ink'
const activeCls = 'bg-card-hover text-ink'

export default function ListRow({ icon, active = false, trailing, className = '', children, ...rest }: ListRowProps) {
  return (
    <div className={`${base} ${active ? activeCls : idle} ${className}`} {...rest}>
      {icon}
      {children}
      {trailing != null && (
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          {trailing}
        </div>
      )}
    </div>
  )
}
