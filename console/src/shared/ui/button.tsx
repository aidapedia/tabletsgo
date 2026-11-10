import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/shared/lib/utils"
import { Slot } from "radix-ui"

/*
 * shadcn/ui Button, sized for tabletsgo's density (text-xs, semibold).
 *
 * A held-down look — an open menu, a toggled view — comes from `aria-expanded`
 * (Radix triggers set it) or `aria-pressed` (pass it for a toggle). Icons:
 * lucide icons are sized by the button; the app's own icons (`shared/ui/icons`)
 * carry their size, so give them `width`/`height`.
 *
 * Sizes: `default`/`sm`/`lg` for text buttons; `icon-2xs` (18px, a tab's close)
 * … `icon-xl` (40px, a rail button) for icon-only ones; `inline` for a
 * padding-free text action inside a sentence or under a form.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-clip-padding text-xs font-semibold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg.lucide:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-bright aria-expanded:bg-primary-bright aria-pressed:bg-primary-bright",
        outline:
          "border-border bg-muted text-foreground hover:border-input hover:bg-accent aria-expanded:border-input aria-expanded:bg-accent aria-pressed:border-input aria-pressed:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent aria-expanded:bg-accent aria-pressed:bg-accent",
        ghost:
          "text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground",
        destructive:
          "border-destructive/30 bg-transparent text-destructive hover:bg-destructive/10 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 aria-expanded:bg-destructive/10 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:text-primary-bright",
      },
      size: {
        default: "h-8 gap-2 px-3",
        sm: "h-7 gap-1.5 px-2.5 text-[11px]",
        lg: "h-9 gap-2 px-[18px]",
        icon: "size-8",
        "icon-2xs": "size-[18px] rounded [&_svg.lucide:not([class*='size-'])]:size-3",
        "icon-xs": "size-6 rounded-md [&_svg.lucide:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7 rounded-[7px]",
        "icon-lg": "size-[34px]",
        "icon-xl": "size-10",
        inline: "h-auto gap-1.5 rounded-none border-0 p-0 text-[10px] font-normal",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
