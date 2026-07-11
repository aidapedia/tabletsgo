import type { ReactNode } from 'react'

// Tiny uppercase pill for roles/statuses ("admin", "pending", "staged", …).
// `dense` drops the vertical padding for tight spots like diagram nodes.
const TONES = {
  green: 'bg-green/15 text-green-bright',
  amber: 'bg-amber/15 text-amber',
  red: 'bg-red/15 text-red',
  neutral: 'bg-edge text-ink-dim',
  faint: 'bg-ink-faint/20 text-ink-faint',
}

export default function Badge({
  tone = 'neutral',
  dense = false,
  className = '',
  children,
}: {
  tone?: keyof typeof TONES
  dense?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <span className={`rounded ${dense ? 'px-1' : 'px-1.5 py-0.5'} text-[9px] font-bold uppercase tracking-wide ${TONES[tone]} ${className}`}>
      {children}
    </span>
  )
}
