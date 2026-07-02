import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '@/app/providers/ThemeContext'
import {
  useSettings,
  DEFAULT_TABLE_ROW_LIMIT,
  MIN_TABLE_ROW_LIMIT,
  MAX_TABLE_ROW_LIMIT,
} from '@/features/settings'
import { ChevronDown, ChevronLeft, MonitorIcon, MoonIcon, SunIcon } from '@/shared/ui/icons'

// Step amount for the row-limit stepper buttons.
const ROW_LIMIT_STEP = 1000

const THEMES = [
  { id: 'light', label: 'Light', desc: 'Always use a light appearance', Icon: SunIcon },
  { id: 'dark', label: 'Dark', desc: 'Always use a dark appearance', Icon: MoonIcon },
  { id: 'system', label: 'System', desc: 'Match your operating system', Icon: MonitorIcon },
]

export default function Settings() {
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
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
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-[720px] px-6 py-8 max-[720px]:px-4">
        <div className="mb-7 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-soft text-ink-dim hover:bg-elevated hover:text-ink"
            aria-label="Back"
          >
            <ChevronLeft />
          </button>
          <h1 className="text-[19px] font-bold tracking-[-0.3px]">Settings</h1>
        </div>

        <section>
          <h2 className="mb-1 text-sm font-semibold">Appearance</h2>
          <p className="mb-4 text-[12px] text-ink-dim">Choose how Tabletsgo looks to you.</p>

          <div className="grid grid-cols-3 gap-3 max-[520px]:grid-cols-1">
            {THEMES.map(({ id, label, desc, Icon }) => {
              const active = theme === id
              return (
                <button
                  key={id}
                  onClick={() => setTheme(id)}
                  className={`flex flex-col items-start gap-3 rounded-card border p-4 text-left transition-all ${
                    active
                      ? 'border-green bg-card-hover shadow-[0_0_0_3px_rgba(111,207,106,0.18)]'
                      : 'border-edge bg-card hover:border-edge-strong hover:bg-card-hover'
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-[10px] ${
                      active ? 'bg-green text-white' : 'bg-elevated text-ink-dim'
                    }`}
                  >
                    <Icon />
                  </span>
                  <div>
                    <div className="text-[13px] font-semibold">{label}</div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">{desc}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        <section className="mt-9">
          <h2 className="mb-1 text-sm font-semibold">Data</h2>
          <p className="mb-4 text-[12px] text-ink-dim">Control how much data Tabletsgo loads.</p>

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
        </section>
      </div>
    </div>
  )
}
