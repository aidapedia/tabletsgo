import { useState, type ReactNode } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { fieldClass } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/shared/ui/command'

export type SelectOption<V = unknown> = {
  value: V
  label: ReactNode
  /** A dimmed second line in the menu. */
  hint?: ReactNode
  /** Extra text a `searchable` select matches on (say, an email behind a name). */
  keywords?: string
}

type OptionSelectProps<V> = {
  value: V
  /** Receives the option's raw value, not an event — typed after `value`. */
  onChange: (value: V) => void
  options: SelectOption<unknown>[]
  /** Shown when no option matches `value`. */
  placeholder?: ReactNode
  /** Styles the trigger, which carries the field look — width, padding, … */
  className?: string
  disabled?: boolean
  /** A filter box at the top of the menu, for lists long enough that scanning them is work. */
  searchable?: boolean
  searchPlaceholder?: string
  /**
   * `field` (default) draws the input look; `ghost` is bare text and a
   * chevron — for a switcher inside a trail or toolbar (database / schema).
   */
  variant?: 'field' | 'ghost'
  'aria-label'?: string
}

// Bare: no border or fill, just the label and chevron, tinting on hover.
const GHOST =
  'w-auto max-w-full gap-1 rounded border-0 bg-transparent px-1.5 py-0.5 font-medium hover:bg-muted data-[state=open]:bg-muted'

const text = (n: ReactNode) => (typeof n === 'string' || typeof n === 'number' ? String(n) : '')

/**
 * A select built from an `options` array — shadcn's Select, or a Popover +
 * Command combobox when `searchable`. Radix items need non-empty string
 * values, so options are keyed by index and an option's `value` can be
 * anything (an id, `null`, a number, '').
 */
export default function OptionSelect<V>({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  className,
  disabled = false,
  searchable = false,
  searchPlaceholder = 'Search…',
  variant = 'field',
  'aria-label': ariaLabel,
}: OptionSelectProps<V>) {
  const trigger = cn(variant === 'ghost' && GHOST, className)
  const index = options.findIndex((o) => o.value === value)
  const selected = index >= 0 ? options[index] : null

  if (searchable) {
    return (
      <SearchableSelect
        options={options}
        selected={selected}
        onChange={(v) => onChange(v as V)}
        placeholder={placeholder}
        className={trigger}
        disabled={disabled}
        searchPlaceholder={searchPlaceholder}
        ariaLabel={ariaLabel}
      />
    )
  }

  return (
    <Select
      value={index >= 0 ? String(index) : ''}
      onValueChange={(i) => onChange(options[Number(i)].value as V)}
      disabled={disabled}
    >
      <SelectTrigger className={trigger} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder}>{selected?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-[260px] max-w-[280px] min-w-(--radix-select-trigger-width)">
        {options.map((o, i) => (
          <SelectItem key={i} value={String(i)}>
            <span className="min-w-0">
              <span className="block truncate">{o.label}</span>
              {o.hint && <span className="block truncate text-[10px] text-faint">{o.hint}</span>}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function SearchableSelect<V>({
  options,
  selected,
  onChange,
  placeholder,
  className,
  disabled,
  searchPlaceholder,
  ariaLabel,
}: {
  options: SelectOption<V>[]
  selected: SelectOption<V> | null
  onChange: (value: V) => void
  placeholder: ReactNode
  className?: string
  disabled: boolean
  searchPlaceholder: string
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          'flex w-full min-w-0 cursor-pointer items-center justify-between gap-1.5 text-left',
          fieldClass,
          className
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-faint')}>{selected ? selected.label : placeholder}</span>
        <ChevronDownIcon className={cn('size-3.5 shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-max max-w-[280px] min-w-(--radix-popover-trigger-width) p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="text-[11px]" />
          <CommandList className="max-h-[240px]">
            <CommandEmpty className="py-3 text-center text-[11px] text-faint">No matches.</CommandEmpty>
            {options.map((o, i) => (
              <CommandItem
                key={i}
                // Unique (the index), and searchable by label, hint and keywords.
                value={`${i} ${text(o.label)}`}
                keywords={[text(o.label), text(o.hint), o.keywords ?? ''].filter(Boolean)}
                onSelect={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                data-checked={o === selected}
                className="text-[11px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-[10px] text-faint">{o.hint}</span>}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
