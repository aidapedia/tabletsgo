/**
 * A determinate progress bar for work whose end is known — a sync walking a
 * table list, an import walking a file.
 *
 * Deliberately not offered in an indeterminate flavour: a bar that fills at a
 * pace unrelated to the work is a spinner that lies about how far along it is.
 * Where the total isn't knowable, use a spinner and say what is happening.
 */
export default function ProgressBar({
  value,
  max = 100,
  className = '',
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
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={`h-1 w-full overflow-hidden rounded-full bg-edge ${className}`}
    >
      <div
        className="h-full rounded-full bg-green-bright transition-[width] duration-200 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
