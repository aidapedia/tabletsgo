import { cn } from '@/shared/lib/utils'
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group'

/**
 * A segmented toggle (Fields/JSON, A–Z/Z–A) — shadcn's single-select
 * ToggleGroup. Items are keyed by index so an option's value can be anything.
 */
export default function Segmented<V>({
  value,
  onChange,
  options,
  className,
}: {
  value: V
  onChange: (value: V) => void
  options: { value: unknown; label: React.ReactNode }[]
  className?: string
}) {
  const index = options.findIndex((o) => o.value === value)
  return (
    <ToggleGroup
      type="single"
      value={index >= 0 ? String(index) : ''}
      // A single group reports '' when the pressed item is pressed again; a
      // segmented control always has one segment on, so that is ignored.
      onValueChange={(i) => i !== '' && onChange(options[Number(i)].value as V)}
      className={cn('inline-flex rounded-lg border border-border bg-background p-0.5', className)}
    >
      {options.map((o, i) => (
        <ToggleGroupItem
          key={i}
          value={String(i)}
          className="h-auto rounded-[7px] px-3 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-muted data-[state=on]:text-foreground"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
