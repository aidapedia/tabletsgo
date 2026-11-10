import type { HTMLAttributes, ReactNode } from 'react'

/**
 * The label portion of a list row (see `ListRow`). Presentational only — a
 * plain span with no color or cursor of its own — so it inherits the row's
 * idle/active text color and `cursor-pointer` instead of overriding them. The
 * row itself owns the click; keeping the label non-interactive avoids the
 * cursor flip you get from a nested <button>.
 */
type RowLabelProps = {
  className?: string
  children?: ReactNode
} & HTMLAttributes<HTMLSpanElement>

export default function RowLabel({ className = '', children, ...props }: RowLabelProps) {
  return (
    <span className={`min-w-0 flex-1 truncate text-left ${className}`} {...props}>
      {children}
    </span>
  )
}
