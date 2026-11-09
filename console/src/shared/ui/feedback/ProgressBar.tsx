import { cn } from '@/shared/lib/utils'
import { Progress } from '@/shared/ui/progress'

/**
 * A determinate progress bar (shadcn Progress) for work whose end is known — a
 * sync walking a table list, an import walking a file.
 *
 * Deliberately not offered in an indeterminate flavour: a bar that fills at a
 * pace unrelated to the work is a spinner that lies about how far along it is.
 * Where the total isn't knowable, use a spinner and say what is happening.
 */
export default function ProgressBar({
  value,
  max = 100,
  className,
  label,
}: {
  value: number
  max?: number
  className?: string
  /** Accessible name — what this is the progress of. */
  label?: string
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <Progress
      value={pct}
      aria-label={label}
      className={cn('h-1 bg-border [&>[data-slot=progress-indicator]]:bg-primary-bright', className)}
    />
  )
}
