import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * The clickable title portion of a list row (saved query / workflow rows).
 * Deliberately unstyled — no color of its own — so it inherits the parent
 * row's idle/active text color instead of overriding it.
 */
type RowLabelProps = {
  className?: string
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

export default function RowLabel({ className = '', children, ...props }: RowLabelProps) {
  return (
    <button type="button" className={`min-w-0 flex-1 truncate text-left ${className}`} {...props}>
      {children}
    </button>
  )
}
