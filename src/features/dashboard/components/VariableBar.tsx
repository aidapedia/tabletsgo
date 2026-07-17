import { useEffect, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import Popover from '@/shared/ui/overlay/Popover'
import Select from '@/shared/ui/form/Select'
import { controlClass } from '@/shared/ui/form/Input'
import { FilterIcon } from '@/shared/ui/icons'
import type { DashboardVariable } from '../types'
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
  values: Record<string, string>
  onChange: (name: string, value: string) => void
  onAddVariable?: () => void
  refreshKey?: number
}) {
  return (
    <Popover
      align="right"
      width={280}
      keepMounted
      trigger={({ open, toggle }) => (
        <Button variant="subtle" size="sm" icon={FilterIcon} active={open || variables.length > 0} onClick={toggle}>
          {variables.length > 0 ? `Filters (${variables.length})` : 'Filters'}
        </Button>
      )}
    >
      <div className="space-y-3 p-3">
        {variables.length === 0 ? (
          <p className="text-[11px] text-ink-faint">No dynamic variables yet — add one to filter widgets.</p>
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
  value?: string
  onChange: (value: string) => void
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

  // Snap the selection onto a real option once options arrive: keep the
  // current value if still valid, else the default, else the first option.
  useEffect(() => {
    if (!options.length) return
    if (value !== undefined && options.some((o) => o.value === value)) return
    const fallback = options.some((o) => o.value === variable.defaultValue) ? variable.defaultValue! : options[0].value
    onChange(fallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, value])

  return (
    <div className="min-w-[140px]">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        {variable.label || variable.name}
      </div>
      {error ? (
        <div className="max-w-[220px] truncate text-[11px] text-red" title={error}>
          {error}
        </div>
      ) : (
        <Select className={`${controlClass} !py-1.5`} value={value} onChange={onChange} options={options} />
      )}
    </div>
  )
}
