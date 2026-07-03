import type { ButtonHTMLAttributes, ReactNode } from 'react'

// Compact square icon-only button used in sidebar/panel headers. `active`
// pins the hover look (e.g. an open search toggle).
type IconButtonProps = {
  active?: boolean
  className?: string
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

export default function IconButton({ active = false, className = '', children, ...props }: IconButtonProps) {
  return (
    <button
      className={`flex h-[28px] w-[28px] items-center justify-center rounded-[7px] ${
        active ? 'bg-elevated text-ink' : 'text-ink-dim hover:bg-elevated hover:text-ink'
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
