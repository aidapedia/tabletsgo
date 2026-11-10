import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'
import { Label } from '@/shared/ui/label'
import HelpTip from '@/shared/ui/HelpTip'

// A labeled field: shadcn Label + control (children) + optional hint/error text.
// The control (Input/Textarea/Select/checkbox row/…) is passed as children so
// FormField stays agnostic to the input kind.
//
// Spacing between fields belongs here, not on the caller: adding a field to a
// form should never mean also remembering its margin (the fields that forgot
// sat flush against the one above). It's a *bottom* margin so fields laid out
// side by side stay top-aligned — a top margin would push every field but the
// first down. Inside a flex row or a grid the margin is dead space under the
// row, so `index.css` drops it there via the `form-field` marker class; that
// keeps a row's spacing the container's business, as it already was. Override
// either way with `!mb-…` (leading `!`, since equal specificity makes plain
// class order unreliable).
//
// A field that follows something that *isn't* a field (a paragraph, a card)
// still needs its own `mt-…` — a bottom margin can't reach upwards.
//
// `hint` is always shown under the control; `help` hides behind a "?" beside
// the label until hovered — for advice, not for what the field needs to be filled.
export function FormField({
  label,
  htmlFor,
  hint,
  help,
  error,
  className,
  children,
}: {
  label?: ReactNode
  htmlFor?: string
  hint?: ReactNode
  help?: ReactNode
  error?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('form-field mb-4', className)}>
      {label && (
        <div className="mb-2 flex items-center gap-1">
          <Label htmlFor={htmlFor}>
            {label}
          </Label>
          {help && <HelpTip>{help}</HelpTip>}
        </div>
      )}
      {children}
      {hint && <p className="mt-1.5 text-[11px] text-faint">{hint}</p>}
      {error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}
    </div>
  )
}
