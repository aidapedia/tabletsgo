import type { FormHTMLAttributes, LabelHTMLAttributes, ReactNode } from 'react'

// A <form> wrapper. Kept thin — pass `onSubmit`; layout/spacing come from the
// FormField children (or a `className` gap utility).
export function Form({ className = '', children, ...props }: FormHTMLAttributes<HTMLFormElement>) {
  return (
    <form className={className} {...props}>
      {children}
    </form>
  )
}

// A field label. Standalone (e.g. a section heading above a group of controls)
// or used internally by FormField.
export function Label({ className = '', children, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={`mb-2 block text-[11px] font-semibold text-ink-dim ${className}`} {...props}>
      {children}
    </label>
  )
}

// A labeled field: label + control (children) + optional hint/error text.
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
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  className = '',
  children,
}: {
  label?: ReactNode
  htmlFor?: string
  hint?: ReactNode
  error?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`form-field mb-4 ${className}`}>
      {label && (
        <Label htmlFor={htmlFor} className="mb-2">
          {label}
        </Label>
      )}
      {children}
      {hint && <p className="mt-1.5 text-[11px] text-ink-faint">{hint}</p>}
      {error && <p className="mt-1.5 text-[11px] text-red">{error}</p>}
    </div>
  )
}
