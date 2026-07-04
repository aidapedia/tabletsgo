import { useState } from 'react'
import {
  useSettings,
  DEFAULT_TABLE_ROW_LIMIT,
  MIN_TABLE_ROW_LIMIT,
  MAX_TABLE_ROW_LIMIT,
} from '@/features/settings'
import { ChevronDown } from '@/shared/ui/icons'

// Step amount for the row-limit stepper buttons.
const ROW_LIMIT_STEP = 1000

// Table-row-limit control — the "Data" setting (no section chrome).
export default function DataSetting() {
  const { tableRowLimit, setTableRowLimit } = useSettings()
  const [limitDraft, setLimitDraft] = useState(String(tableRowLimit))

  const clamp = (n) => Math.min(Math.max(n, MIN_TABLE_ROW_LIMIT), MAX_TABLE_ROW_LIMIT)

  const commitLimit = () => {
    const n = parseInt(limitDraft, 10)
    const value = Number.isFinite(n) ? clamp(n) : DEFAULT_TABLE_ROW_LIMIT
    setTableRowLimit(value)
    setLimitDraft(String(value))
  }

  const step = (delta) => {
    const n = parseInt(limitDraft, 10)
    const value = clamp((Number.isFinite(n) ? n : tableRowLimit) + delta)
    setTableRowLimit(value)
    setLimitDraft(String(value))
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-card border border-edge bg-card p-4">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">Table row limit</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">
          Maximum rows fetched when opening a table tab (1–{MAX_TABLE_ROW_LIMIT.toLocaleString()}).
        </div>
      </div>
      <div className="flex h-10 w-36 shrink-0 items-stretch overflow-hidden rounded-soft border border-edge bg-bg focus-within:border-green-dim">
        <input
          type="number"
          min={MIN_TABLE_ROW_LIMIT}
          max={MAX_TABLE_ROW_LIMIT}
          value={limitDraft}
          onChange={(e) => setLimitDraft(e.target.value)}
          onBlur={commitLimit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'ArrowUp') { e.preventDefault(); step(ROW_LIMIT_STEP) }
            else if (e.key === 'ArrowDown') { e.preventDefault(); step(-ROW_LIMIT_STEP) }
          }}
          className="min-w-0 flex-1 bg-transparent px-3 text-right text-[13px] text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <div className="flex w-7 shrink-0 flex-col border-l border-edge">
          <button
            type="button"
            aria-label="Increase row limit"
            onClick={() => step(ROW_LIMIT_STEP)}
            disabled={tableRowLimit >= MAX_TABLE_ROW_LIMIT}
            className="flex flex-1 items-center justify-center text-ink-dim transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronDown width={13} height={13} className="rotate-180" />
          </button>
          <button
            type="button"
            aria-label="Decrease row limit"
            onClick={() => step(-ROW_LIMIT_STEP)}
            disabled={tableRowLimit <= MIN_TABLE_ROW_LIMIT}
            className="flex flex-1 items-center justify-center border-t border-edge text-ink-dim transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronDown width={13} height={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
