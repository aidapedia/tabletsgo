import * as React from "react"
import { cn } from "@/shared/lib/utils"

/*
 * shadcn/ui Input, in tabletsgo's field look. Height comes from padding, so a
 * caller that needs a compact field passes `py-1` rather than a height.
 * `fieldClass` is that look on its own — for a control that is not an
 * <input> but must read as a field (a read-only value, a loading placeholder).
 */
export const fieldClass =
  "rounded-lg border border-border bg-muted px-3 py-2 text-[11px] text-foreground outline-none transition-[color,box-shadow,border-color] placeholder:text-faint focus-visible:border-ring/40 focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "w-full min-w-0 file:inline-flex file:border-0 file:bg-transparent file:text-[11px] file:font-medium file:text-foreground",
        fieldClass,
        className
      )}
      {...props}
    />
  )
}

export { Input }
