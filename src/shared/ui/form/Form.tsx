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
    <div className={className}>
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
