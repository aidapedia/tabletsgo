import type { ReactNode } from 'react'

// Centered faint placeholder for empty lists. `bordered` wraps it in the soft
// box used by list panels (e.g. "No teams yet."). Padding lives in the default
// `className` so callers can swap it (e.g. className="py-16") without conflicts.
export default function EmptyState({
  children,
  bordered = false,
  className = 'py-6',
}: {
  children: ReactNode
  bordered?: boolean
  className?: string
}) {
  const box = bordered ? 'rounded-soft border border-edge bg-elevated/30' : ''
  return <div className={`${box} text-center text-xs text-ink-faint ${className}`}>{children}</div>
}
