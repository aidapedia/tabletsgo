import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Underline tab button used in tab bars (Workspace/Settings sections,
 * connection detail, connection modal). Render inside a
 * `flex ... border-b border-edge` container.
 * Props: active, accent ('green' | 'ink' active underline), children.
 */
type TabProps = {
  active?: boolean
  accent?: 'green' | 'ink'
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

export default function Tab({ active = false, accent = 'green', className = '', children, ...props }: TabProps) {
  const activeLook = accent === 'ink' ? 'border-ink text-ink' : 'border-green text-ink'
  return (
    <button
      type="button"
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-1 pb-2.5 text-[13px] font-medium transition-colors ${
        active ? activeLook : 'border-transparent text-ink-dim hover:text-ink'
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
