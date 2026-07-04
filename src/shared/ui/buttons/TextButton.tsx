import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Inline, padding-free text button (back links, "show all" / "hide all",
 * copy-link and other low-emphasis inline actions). For solid/bordered
 * buttons use `Button`; for icon-only use `IconButton`.
 * Props: tone (color), plus button attributes.
 */
const TONES = {
  dim: 'text-ink-dim hover:text-ink',
  green: 'text-green hover:text-green-bright',
  red: 'text-red hover:text-red/80',
  faint: 'text-ink-faint hover:text-ink',
}

type TextButtonProps = {
  tone?: keyof typeof TONES
  /** Full-width, centered layout (e.g. "Back to sign in" under an auth form). Default: inline with icon gap. */
  block?: boolean
  className?: string
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

export default function TextButton({ tone = 'dim', block = false, className = '', children, ...props }: TextButtonProps) {
  const layout = block ? 'block w-full text-center' : 'inline-flex items-center gap-1.5'
  return (
    <button type="button" className={`${layout} text-[10px] transition-colors ${TONES[tone]} ${className}`} {...props}>
      {children}
    </button>
  )
}
