import { HelpIcon } from '@/shared/ui/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

/**
 * A small "?" that explains the thing beside it on hover or focus — for advice
 * worth having to hand but not worth a line of text under every field.
 * `FormField`'s `help` draws one next to its label.
 */
export default function HelpTip({ children, placement = 'top' }: { children: React.ReactNode; placement?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Help"
          className="inline-flex cursor-help items-center text-faint transition-colors hover:text-muted-foreground focus-visible:text-muted-foreground focus-visible:outline-none"
        >
          <HelpIcon width={12} height={12} />
        </button>
      </TooltipTrigger>
      {children && <TooltipContent side={placement} className="max-w-[280px] whitespace-pre-wrap break-words text-left">{children}</TooltipContent>}
    </Tooltip>
  )
}
