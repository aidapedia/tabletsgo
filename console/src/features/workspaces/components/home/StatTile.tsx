import type { ComponentType, ReactNode, SVGProps } from 'react'
import { cn } from '@/shared/lib/utils'

/**
 * One number on the home page, and the line under it that says what it means.
 * A tile with `onClick` is a button into the section that owns the number —
 * the number is the summary, the section is the detail.
 */
export default function StatTile({
  Icon,
  label,
  value,
  hint,
  tone = 'default',
  onClick,
}: {
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  label: string
  value: ReactNode
  hint?: ReactNode
  /** `alert` when the hint reports something that needs a look (a failed run). */
  tone?: 'default' | 'alert'
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'group flex min-w-0 flex-col rounded-xl border border-border bg-card p-4 text-left',
        onClick && 'transition-colors hover:border-input hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
          <Icon width={14} height={14} />
        </span>
      </div>
      <div className="mt-1 text-[28px] leading-none font-bold tracking-tight tabular-nums">{value}</div>
      {hint && (
        <div className={cn('mt-2 truncate text-[11px]', tone === 'alert' ? 'text-destructive' : 'text-faint')}>{hint}</div>
      )}
    </Tag>
  )
}
