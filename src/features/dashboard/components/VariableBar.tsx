import { useEffect, useState } from 'react'
import Popover from '@/shared/ui/overlay/Popover'
import Select from '@/shared/ui/form/Select'
import Checkbox from '@/shared/ui/form/Checkbox'
import Button from '@/shared/ui/buttons/Button'
import { controlClass } from '@/shared/ui/form/Input'
import { FilterIcon, PlusIcon } from '@/shared/ui/icons'
import type { DashboardVariable, VariableValues } from '../types'
import { resolveVariableOptions, type VariableOption } from '../lib/variables'

// Dynamic-variable filters, tucked behind a toolbar "Filters" button (next to
// Refresh) instead of a permanent row. Uses Popover's `keepMounted` so each
// VariablePicker's resolve-options-then-apply-default effect runs as soon as
// the dashboard loads, not only once the user opens this panel — otherwise
// widgets referencing {{name}} would sit unresolved until then. `align="right"`
// keeps the panel from spilling past the right edge of the screen.
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
  return (
    <Popover
      align="right"
      width={280}
      portal
      keepMounted
      trigger={({ open, toggle }) => (
        <Button variant="subtle" size="sm" icon={FilterIcon} active={open || variables.length > 0} onClick={toggle}>
          {variables.length > 0 ? `Filters (${variables.length})` : 'Filters'}
        </Button>
      )}
    >
      <div className="space-y-3 p-3">
        {variables.length === 0 ? (
          <div className="space-y-2.5">
            <p className="text-[11px] text-ink-faint">No dynamic variables yet — add one to filter widgets.</p>
            {onAddVariable && (
              <Button variant="subtle" size="sm" icon={PlusIcon} onClick={onAddVariable} className="w-full">
                Add variable
              </Button>
            )}
          </div>
        ) : (
          variables.map((v) => (
            <VariablePicker
              key={v.id}
              conn={conn}
              variable={v}
              value={values[v.name]}
              onChange={(val) => onChange(v.name, val)}
              refreshKey={refreshKey}
            />
          ))
        )}
      </div>
    </Popover>
  )
}

function VariablePicker({
  conn,
  variable,
  value,
  onChange,
  refreshKey,
}: {
  conn: any
  variable: DashboardVariable
  value?: string | string[]
  onChange: (value: string | string[]) => void
  refreshKey: number
}) {
  const [options, setOptions] = useState<VariableOption[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setError(null)
    resolveVariableOptions(conn, variable)
      .then((opts) => alive && setOptions(opts))
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.id, conn?.ns?.database, conn?.ns?.schema, variable.source, variable.query, variable.values, refreshKey])

  // Snap the selection onto real options once they arrive. Single-select keeps
  // the current value if still valid, else the default, else the first option.
  // Multi-select initializes to the default (if any) or all options selected,
  // then only prunes values that no longer exist — never re-fills after the
  // user has deliberately narrowed (or cleared) the set.
  useEffect(() => {
    if (!options.length) return
    const optVals = options.map((o) => o.value)
    if (variable.multi) {
      if (value === undefined) {
        const def = variable.defaultValue && optVals.includes(variable.defaultValue) ? [variable.defaultValue] : optVals
        onChange(def)
        return
      }
      const arr = Array.isArray(value) ? value : [String(value)]
      const pruned = arr.filter((v) => optVals.includes(v))
      if (pruned.length !== arr.length) onChange(pruned)
      return
    }
    if (typeof value === 'string' && optVals.includes(value)) return
    const fallback = variable.defaultValue && optVals.includes(variable.defaultValue) ? variable.defaultValue : options[0].value
    onChange(fallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, value, variable.multi])

  const label = variable.label || variable.name

  if (error) {
    return (
      <div className="min-w-[140px]">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</div>
        <div className="max-w-[220px] truncate text-[11px] text-red" title={error}>
          {error}
        </div>
      </div>
    )
  }

  if (variable.multi) {
    const selected = Array.isArray(value) ? value : value ? [value] : []
    const allSelected = options.length > 0 && selected.length === options.length
    const toggle = (val: string) =>
      onChange(selected.includes(val) ? selected.filter((s) => s !== val) : [...selected, val])
    const toggleAll = () => onChange(allSelected ? [] : options.map((o) => o.value))

    return (
      <div className="min-w-[140px]">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
          <span className="text-[10px] text-ink-faint">
            {selected.length}/{options.length}
          </span>
        </div>
        <div className="max-h-[184px] overflow-y-auto rounded-soft border border-edge bg-bg/40">
          <label className="flex cursor-pointer items-center gap-2 border-b border-edge px-2.5 py-1.5">
            <Checkbox
              checked={allSelected}
              indeterminate={selected.length > 0 && !allSelected}
              onChange={toggleAll}
              ariaLabel="Select all"
            />
            <span className="text-[11px] font-medium text-ink">Select all</span>
          </label>
          {options.map((o) => (
            <label key={String(o.value)} className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 hover:bg-card-hover">
              <Checkbox checked={selected.includes(o.value)} onChange={() => toggle(o.value)} ariaLabel={o.label} />
              <span className="min-w-0 flex-1 truncate text-[11px] text-ink-dim">{o.label}</span>
            </label>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="min-w-[140px]">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</div>
      <Select
        className={`${controlClass} !py-1.5`}
        value={typeof value === 'string' ? value : undefined}
        onChange={onChange}
        options={options}
      />
    </div>
  )
}
