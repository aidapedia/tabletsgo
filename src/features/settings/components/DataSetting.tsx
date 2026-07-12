import {
  useSettings,
  MIN_TABLE_ROW_LIMIT,
  MAX_TABLE_ROW_LIMIT,
  MIN_QUERY_TIMEOUT,
  MAX_QUERY_TIMEOUT,
} from '@/features/settings'
import NumberStepper from '@/shared/ui/form/NumberStepper'
import Toggle from '@/shared/ui/form/Toggle'

// Step amount for the row-limit stepper buttons.
const ROW_LIMIT_STEP = 1000

// One labelled settings row (title + description on the left, control on the right).
function SettingRow({ title, desc, children }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-card border border-edge bg-card p-4">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">{desc}</div>
      </div>
      {children}
    </div>
  )
}

// Data / query-execution settings (no section chrome).
export default function DataSetting() {
  const { tableRowLimit, setTableRowLimit, queryTimeout, setQueryTimeout, directExecute, setDirectExecute } =
    useSettings()

  return (
    <div className="space-y-3">
      <SettingRow
        title="Table row limit"
        desc={`Maximum rows fetched when opening a table tab (1–${MAX_TABLE_ROW_LIMIT.toLocaleString()}).`}
      >
        <NumberStepper
          value={tableRowLimit}
          onChange={setTableRowLimit}
          min={MIN_TABLE_ROW_LIMIT}
          max={MAX_TABLE_ROW_LIMIT}
          step={ROW_LIMIT_STEP}
          ariaLabel="row limit"
          className="w-36 shrink-0"
        />
      </SettingRow>

      <SettingRow
        title="Query timeout"
        desc={`Abort a running query after this many seconds (${MIN_QUERY_TIMEOUT}–${MAX_QUERY_TIMEOUT.toLocaleString()}).`}
      >
        <NumberStepper
          value={queryTimeout}
          onChange={setQueryTimeout}
          min={MIN_QUERY_TIMEOUT}
          max={MAX_QUERY_TIMEOUT}
          step={5}
          ariaLabel="query timeout in seconds"
          className="w-36 shrink-0"
        />
      </SettingRow>

      <SettingRow
        title="Direct execute"
        desc="Run data and schema changes immediately instead of staging them in the Changes panel for a later commit."
      >
        <Toggle checked={directExecute} onChange={setDirectExecute} ariaLabel="direct execute" />
      </SettingRow>
    </div>
  )
}
