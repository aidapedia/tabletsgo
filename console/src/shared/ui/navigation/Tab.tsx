import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Underline tab button used in tab bars (Workspace/Settings sections,
 * connection detail, connection modal). Render inside a
 * `flex ... border-b border-border` container.
 * Props: active, accent ('green' | 'ink' active underline), children.
 */
type TabProps = {
  active?: boolean
  accent?: 'green' | 'ink'
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

export default function Tab({ active = false, accent = 'green', className = '', children, ...props }: TabProps) {
  const activeLook = accent === 'ink' ? 'border-foreground text-foreground' : 'border-primary text-foreground'
  return (
    <button
      type="button"
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-1 pb-2.5 text-[13px] font-medium transition-colors ${
        active ? activeLook : 'border-transparent text-muted-foreground hover:text-foreground'
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
