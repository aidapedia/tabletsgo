import { forwardRef } from 'react'
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

// Base styling for text controls. Exported so components that aren't a plain
// <input> (e.g. the custom Select box) can share the exact same field look.
export const controlClass =
  'w-full px-3 py-2 bg-elevated border border-edge rounded-soft text-ink text-[11px] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-faint focus:border-green-dim focus:shadow-[0_0_0_3px_rgba(111,207,106,0.22)]'

// Styled text input. `className` is appended so callers can tweak width etc.
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => <input ref={ref} className={`${controlClass} ${className}`} {...props} />
)
Input.displayName = 'Input'

// Styled multi-line input, sharing the same field look.
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = '', ...props }, ref) => <textarea ref={ref} className={`${controlClass} ${className}`} {...props} />
)
Textarea.displayName = 'Textarea'
