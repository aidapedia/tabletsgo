import * as React from "react"
import { cn } from "@/shared/lib/utils"
import { Label as LabelPrimitive } from "radix-ui"

/* shadcn/ui Label, in tabletsgo's small semibold field-label type. */
function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-[11px] leading-none font-semibold text-muted-foreground select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
