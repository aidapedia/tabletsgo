import { useEffect, useMemo, useState } from 'react'
import Popover from '@/shared/ui/overlay/Popover'
import SearchInput from '@/shared/ui/form/SearchInput'
import { ChevronDown, FilterIcon } from '@/shared/ui/icons'
import type { DashboardVariable, VariableValues } from '../types'
import { resolveVariableOptions, type VariableOption } from '../lib/variables'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'

type OptionsByName = Record<string, VariableOption[]>
type ErrorsByName = Record<string, string>

// Resolve every variable's options once, at the bar level, so each chip can show
// a value's display label and apply its default without the dropdown ever being
// opened. Re-runs when the connection, a variable's definition, or the dashboard
// refreshKey changes.
function useVariableOptions(conn: any, variables: DashboardVariable[], refreshKey: number) {
  const [options, setOptions] = useState<OptionsByName>({})
  const [errors, setErrors] = useState<ErrorsByName>({})
  const sig = variables.map((v) => `${v.id} ${v.source} ${v.query ?? ''} ${v.values ?? ''}`).join('')

  useEffect(() => {
    let alive = true
    Promise.all(
      variables.map(async (v) => {
        try {
          return [v.name, await resolveVariableOptions(conn, v), null] as const
        } catch (e: any) {
          return [v.name, [] as VariableOption[], e.message as string] as const
        }
      })
    ).then((results) => {
      if (!alive) return
      const o: OptionsByName = {}
      const er: ErrorsByName = {}
      for (const [name, list, err] of results) {
        o[name] = list
        if (err) er[name] = err
      }
      setOptions(o)
      setErrors(er)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.id, conn?.ns?.database, conn?.ns?.schema, sig, refreshKey])

  return { options, errors }
}

// The value a variable should snap to once options resolve, or `undefined` when
// the current selection is already valid (no change needed). Single-select keeps
// a valid value, else the default, else the first option. Multi-select initializes
// to the default (or all) and thereafter only prunes values that no longer exist —
// never re-filling after the user deliberately narrowed or cleared the set.
function snapValue(
  variable: DashboardVariable,
  value: string | string[] | undefined,
  options: VariableOption[]
): string | string[] | undefined {
  if (!options.length) return undefined
  const optVals = options.map((o) => o.value)
  if (variable.multi) {
    if (value === undefined) return variable.defaultValue && optVals.includes(variable.defaultValue) ? [variable.defaultValue] : optVals
    const arr = Array.isArray(value) ? value : [String(value)]
    const pruned = arr.filter((v) => optVals.includes(v))
    return pruned.length !== arr.length ? pruned : undefined
  }
  if (typeof value === 'string' && optVals.includes(value)) return undefined
  return variable.defaultValue && optVals.includes(variable.defaultValue) ? variable.defaultValue : options[0].value
}

// One-line summary of a variable's current selection for its chip.
function summarize(variable: DashboardVariable, value: string | string[] | undefined, options: VariableOption[]): string {
  const labelFor = (val: string) => options.find((o) => o.value === val)?.label ?? val
  if (variable.multi) {
    const arr = Array.isArray(value) ? value : value ? [value] : []
    if (arr.length === 0) return 'None'
    if (options.length > 0 && arr.length === options.length) return 'All'
    if (arr.length === 1) return labelFor(arr[0])
    return `${arr.length} selected`
  }
  if (value === undefined || value === '') return '…'
  return labelFor(String(value))
}

// Dynamic-variable filters rendered as faceted chips: each variable is its own
// dropdown (click the chip to change just that filter). Option resolution and
// default-application happen here at the bar so widgets referencing {{name}}
// resolve on load, before any chip is opened.
export default function VariableBar({
  conn,
  variables,
  values,
  onChange,
  onAddVariable,
  refreshKey = 0,
}: {
  conn: any
  variables: DashboardVariable[]
  values: VariableValues
  onChange: (name: string, value: string | string[]) => void
  onAddVariable?: () => void
  refreshKey?: number
}) {
  const { options, errors } = useVariableOptions(conn, variables, refreshKey)

  // Apply each variable's default/prune once its options are known.
  useEffect(() => {
    for (const v of variables) {
      const next = snapValue(v, values[v.name], options[v.name] || [])
      if (next !== undefined) onChange(v.name, next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, values, variables])

  if (variables.length === 0) {
    return onAddVariable ? (
      <Button variant="ghost" size="sm" onClick={onAddVariable}>
        <FilterIcon width={15} height={15} />
        Add filter
      </Button>
    ) : null
  }

  // Keep the toolbar bounded: show the first few filters as chips, collapse the
  // rest behind a "+N more" popover so a dashboard with many variables doesn't
  // wrap the toolbar into a wall of chips.
  const hasOverflow = variables.length > MAX_INLINE_CHIPS
  const inlineVars = hasOverflow ? variables.slice(0, MAX_INLINE_CHIPS - 1) : variables
  const overflowVars = hasOverflow ? variables.slice(MAX_INLINE_CHIPS - 1) : []

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {inlineVars.map((v) => (
        <FilterChip
          key={v.id}
          variable={v}
          value={values[v.name]}
          options={options[v.name] || []}
          error={errors[v.name]}
          onChange={(val) => onChange(v.name, val)}
        />
      ))}
      {hasOverflow && (
        <FilterOverflow variables={overflowVars} values={values} options={options} errors={errors} onChange={onChange} />
      )}
    </div>
  )
}

// Beyond this many variables, the extras collapse into a "+N more" popover.
const MAX_INLINE_CHIPS = 4

function FilterChip({
  variable,
  value,
  options,
  error,
  onChange,
}: {
  variable: DashboardVariable
  value?: string | string[]
  options: VariableOption[]
  error?: string
  onChange: (value: string | string[]) => void
}) {
  const label = variable.label || variable.name
  const summary = error ? '!' : summarize(variable, value, options)

  return (
    <Popover
      portal
      align="left"
      width={variable.multi ? 220 : 200}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          title={`${label}: ${error ? error : summary}`}
          className={`flex items-center gap-1.5 rounded-[7px] border py-1 pl-2.5 pr-2 text-[11px] transition-colors ${
            open ? 'border-primary/50 bg-muted' : 'border-input bg-muted hover:bg-accent'
          }`}
        >
          <span className="text-faint">{label}:</span>
          <span className={`max-w-[140px] truncate font-medium ${error ? 'text-destructive' : 'text-foreground'}`}>{summary}</span>
          <ChevronDown width={11} height={11} className={`shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      {({ close }) =>
        error ? (
          <div className="max-w-[260px] px-3 py-2 text-[11px] text-destructive">{error}</div>
        ) : variable.multi ? (
          <MultiOptions options={options} value={value} onChange={onChange} />
        ) : (
          <SingleOptions
            options={options}
            value={typeof value === 'string' ? value : undefined}
            onChange={(v) => {
              onChange(v)
              close()
            }}
          />
        )
      }
    </Popover>
  )
}

// Collapses the overflow variables into one popover. Each is an accordion row
// (label + current value) that expands to its picker inline — no nested popovers,
// so it stays bounded and dismiss-safe.
function FilterOverflow({
  variables,
  values,
  options,
  errors,
  onChange,
}: {
  variables: DashboardVariable[]
  values: VariableValues
  options: OptionsByName
  errors: ErrorsByName
  onChange: (name: string, value: string | string[]) => void
}) {
  return (
    <Popover
      portal
      align="right"
      width={248}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className={`flex items-center gap-1 rounded-[7px] border py-1 px-2 text-[11px] font-medium transition-colors ${
            open ? 'border-primary/50 bg-muted text-foreground' : 'border-input bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
        >
          +{variables.length} more
          <ChevronDown width={11} height={11} className={`text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      {() => (
        <div className="max-h-[380px] overflow-y-auto p-1">
          {variables.map((v) => (
            <OverflowRow
              key={v.id}
              variable={v}
              value={values[v.name]}
              options={options[v.name] || []}
              error={errors[v.name]}
              onChange={(val) => onChange(v.name, val)}
            />
          ))}
        </div>
      )}
    </Popover>
  )
}

function OverflowRow({
  variable,
  value,
  options,
  error,
  onChange,
}: {
  variable: DashboardVariable
  value?: string | string[]
  options: VariableOption[]
  error?: string
  onChange: (value: string | string[]) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const label = variable.label || variable.name
  const summary = error ? '!' : summarize(variable, value, options)

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-accent"
      >
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</span>
        <span className={`ml-auto max-w-[110px] truncate text-[11px] font-medium ${error ? 'text-destructive' : 'text-foreground'}`}>{summary}</span>
        <ChevronDown width={11} height={11} className={`shrink-0 text-faint transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded &&
        (error ? (
          <div className="px-2 pb-2 text-[11px] text-destructive">{error}</div>
        ) : variable.multi ? (
          <MultiOptions options={options} value={value} onChange={onChange} />
        ) : (
          <SingleOptions
            options={options}
            value={typeof value === 'string' ? value : undefined}
            onChange={(v) => {
              onChange(v)
              setExpanded(false)
            }}
          />
        ))}
    </div>
  )
}

// Single-select option list: pick one, the caller closes the dropdown.
function SingleOptions({ options, value, onChange }: { options: VariableOption[]; value?: string; onChange: (v: string) => void }) {
  const [search, setSearch] = useState('')
  const filtered = useMemo(
    () => (search ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase())) : options),
    [options, search],
  )
  return (
    <div>
      {options.length > 6 && (
        <div className="px-1.5 pt-1.5">
          <SearchInput
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full"
            inputClassName="!h-7 !text-[11px]"
            iconSize={13}
          />
        </div>
      )}
      {!filtered.length ? (
        <div className="px-3 py-2 text-[11px] text-faint">No options</div>
      ) : (
        <div className="max-h-[260px] overflow-y-auto p-1">
          {filtered.map((o) => {
            const active = o.value === value
            return (
              <button
                key={String(o.value)}
                type="button"
                onClick={() => onChange(o.value)}
                className={`flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                  active ? 'bg-primary/15 text-primary-bright' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {active && <span className="shrink-0 text-primary">✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Multi-select checklist with a "Select all" header; stays open while toggling.
function MultiOptions({
  options,
  value,
  onChange,
}: {
  options: VariableOption[]
  value?: string | string[]
  onChange: (v: string[]) => void
}) {
  const [search, setSearch] = useState('')
  const filtered = useMemo(
    () => (search ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase())) : options),
    [options, search],
  )
  const selected = Array.isArray(value) ? value : value ? [value] : []
  const allSelected = selected.length === options.length
  const toggle = (val: string) => onChange(selected.includes(val) ? selected.filter((s) => s !== val) : [...selected, val])

  return (
    <div className="p-1">
      {options.length > 6 && (
        <div className="px-1.5 py-1">
          <SearchInput
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full"
            inputClassName="!h-7 !text-[11px]"
            iconSize={13}
          />
        </div>
      )}
      <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-accent">
        <Checkbox onClick={(e) => e.stopPropagation()}
          checked={selected.length > 0 && !allSelected ? 'indeterminate' : allSelected}
          
          onCheckedChange={() => onChange(allSelected ? [] : options.map((o) => o.value))}
          aria-label="Select all"
        />
        <span className="text-[11px] font-medium text-foreground">Select all</span>
      </label>
      <div className="my-1 h-px bg-border" />
      {!filtered.length ? (
        <div className="px-3 py-2 text-[11px] text-faint">No matching options</div>
      ) : (
        <div className="max-h-[220px] overflow-y-auto">
          {filtered.map((o) => (
            <label key={String(o.value)} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-accent">
              <Checkbox onClick={(e) => e.stopPropagation()} checked={selected.includes(o.value)} onCheckedChange={() => toggle(o.value)} aria-label={o.label} />
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
