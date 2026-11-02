import Tooltip from '@/shared/ui/overlay/Tooltip'
import { HelpIcon } from '@/shared/ui/icons'

/**
 * A small "?" that explains the thing beside it on hover or focus — for advice
 * worth having to hand but not worth a line of text under every field.
 * `FormField`'s `help` draws one next to its label.
 */
export default function HelpTip({ children, placement = 'top' }: { children: React.ReactNode; placement?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip label={children} placement={placement} multiline>
      <button
        type="button"
        aria-label="Help"
        className="inline-flex cursor-help items-center text-ink-faint transition-colors hover:text-ink-dim focus-visible:text-ink-dim focus-visible:outline-none"
      >
        <HelpIcon width={12} height={12} />
      </button>
    </Tooltip>
  )
}
