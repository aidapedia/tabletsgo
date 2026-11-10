import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/shared/lib/utils"
import { Slot } from "radix-ui"

/*
 * shadcn/ui Badge, in tabletsgo's shape: a tiny uppercase pill for roles and
 * states ("admin", "pending", "staged", …). `size="dense"` drops the vertical
 * padding for tight spots like diagram nodes.
 */
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded border border-transparent text-[9px] font-bold tracking-wide whitespace-nowrap uppercase transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg.lucide]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary/15 text-primary-bright",
        secondary: "bg-border text-muted-foreground",
        destructive: "bg-destructive/15 text-destructive",
        warning: "bg-warning/15 text-warning",
        faint: "bg-faint/20 text-faint",
        outline: "border-border text-muted-foreground",
      },
      size: {
        default: "px-1.5 py-0.5",
        dense: "px-1",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  }
)

function Badge({
  className,
  variant = "secondary",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
