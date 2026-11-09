import type { ReactNode } from 'react'
import { Checkbox } from '@/shared/ui/checkbox'

// Bordered selectable row: a Checkbox followed by arbitrary row content
// (avatar, labels, trailing hints). Used for picking members/teams/destinations.
export default function CheckboxRow({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
  className = '',
  children,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  ariaLabel?: string
  className?: string
  children: ReactNode
}) {
  return (
    <label className={`flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2 ${className}`}>
      <Checkbox onClick={(e) => e.stopPropagation()} checked={checked} onCheckedChange={(checked) => onChange(checked === true)} disabled={disabled} aria-label={ariaLabel} />
      {children}
    </label>
  )
}
