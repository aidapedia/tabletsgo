import * as React from "react"
import { cn } from "@/shared/lib/utils"
import { fieldClass } from "@/shared/ui/input"

/* shadcn/ui Textarea, sharing Input's field look; `rows` sets its height. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn("block w-full", fieldClass, className)} {...props} />
}

export { Textarea }
