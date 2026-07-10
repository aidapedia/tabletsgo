import {
  useSettings,
  MIN_TABLE_ROW_LIMIT,
  MAX_TABLE_ROW_LIMIT,
} from '@/features/settings'
import NumberStepper from '@/shared/ui/form/NumberStepper'

// Step amount for the row-limit stepper buttons.
const ROW_LIMIT_STEP = 1000

// Table-row-limit control — the "Data" setting (no section chrome).
export default function DataSetting() {
  const { tableRowLimit, setTableRowLimit } = useSettings()

  return (
    <div className="flex items-center justify-between gap-4 rounded-card border border-edge bg-card p-4">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">Table row limit</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">
          Maximum rows fetched when opening a table tab (1–{MAX_TABLE_ROW_LIMIT.toLocaleString()}).
        </div>
      </div>
      <NumberStepper
        value={tableRowLimit}
        onChange={setTableRowLimit}
        min={MIN_TABLE_ROW_LIMIT}
        max={MAX_TABLE_ROW_LIMIT}
        step={ROW_LIMIT_STEP}
        ariaLabel="row limit"
        className="w-36 shrink-0"
      />
    </div>
  )
}
