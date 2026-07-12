import { useMemo, useState } from 'react'
import Popover from '@/shared/ui/overlay/Popover'
import { CalendarIcon, ChevronLeft, ChevronRight } from '@/shared/ui/icons'

// App-styled date picker. `value`/`onChange` speak plain 'YYYY-MM-DD' strings
// (empty string = no date), matching how the app stores date parts — so it can
// drop in wherever a native <input type="date"> was used.

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3))

const pad = (n) => String(n).padStart(2, '0')
const toStr = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`

// Parse 'YYYY-MM-DD' into {y,m,d} (m 0-based) without going through Date() to
// avoid timezone shifts.
function parse(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '')
  if (!m) return null
  return { y: +m[1], m: +m[2] - 1, d: +m[3] }
}

const triggerClass =
  'flex w-full items-center gap-2 px-3 py-2 bg-elevated border border-edge rounded-soft text-ink text-[11px] outline-none transition-[border-color,box-shadow] duration-150 hover:border-edge-strong'

const navBtn = 'rounded-soft p-1 text-ink-dim hover:bg-card-hover hover:text-ink'
const cellBtn = 'flex items-center justify-center rounded-soft text-[12px] transition-colors'

export default function DatePicker({ value = '', onChange, autoFocus = false, className = '' }) {
  const sel = parse(value)
  const today = new Date()
  const [view, setView] = useState(() =>
    sel ? { y: sel.y, m: sel.m } : { y: today.getFullYear(), m: today.getMonth() }
  )
  // Which zoom level the panel shows: pick a day, a month, or a year.
  const [mode, setMode] = useState('days')

  const grid = useMemo(() => {
    const first = new Date(view.y, view.m, 1).getDay()
    const days = new Date(view.y, view.m + 1, 0).getDate()
    const cells = []
    for (let i = 0; i < first; i++) cells.push(null)
    for (let d = 1; d <= days; d++) cells.push(d)
    return cells
  }, [view])

  // First year of the 12-year page the current view sits in.
  const yearPage = view.y - (((view.y % 12) + 12) % 12)

  const stepMonth = (delta) => {
    const m = view.m + delta
    setView({ y: view.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 })
  }
  const step = (delta) => {
    if (mode === 'days') stepMonth(delta)
    else if (mode === 'months') setView((v) => ({ ...v, y: v.y + delta }))
    else setView((v) => ({ ...v, y: v.y + delta * 12 }))
  }

  const headerLabel =
    mode === 'days' ? `${MONTHS[view.m]} ${view.y}` : mode === 'months' ? String(view.y) : `${yearPage}–${yearPage + 11}`

  const isToday = (d) =>
    d === today.getDate() && view.m === today.getMonth() && view.y === today.getFullYear()
  const isSel = (d) => sel && d === sel.d && view.m === sel.m && view.y === sel.y

  const label = sel ? toStr(sel.y, sel.m, sel.d) : ''

  return (
    <Popover
      width={264}
      portal
      trigger={({ toggle }) => (
        <button type="button" autoFocus={autoFocus} onClick={toggle} className={`${triggerClass} ${className}`}>
          <span className={label ? 'text-ink' : 'text-ink-faint'}>{label || 'Select date'}</span>
          <CalendarIcon className="ml-auto text-ink-faint" />
        </button>
      )}
    >
      {({ close }) => (
        <div className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => step(-1)} className={navBtn}>
              <ChevronLeft />
            </button>
            <button
              type="button"
              onClick={() => setMode(mode === 'days' ? 'months' : mode === 'months' ? 'years' : 'days')}
              className="rounded-soft px-2 py-1 text-[12px] font-medium text-ink hover:bg-card-hover"
            >
              {headerLabel}
            </button>
            <button type="button" onClick={() => step(1)} className={navBtn}>
              <ChevronRight />
            </button>
          </div>

          {mode === 'days' && (
            <div className="grid grid-cols-7 gap-y-1">
              {WEEKDAYS.map((w, i) => (
                <div key={i} className="flex h-7 items-center justify-center text-[10px] font-medium text-ink-faint">
                  {w}
                </div>
              ))}
              {grid.map((d, i) =>
                d === null ? (
                  <div key={i} />
                ) : (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { onChange?.(toStr(view.y, view.m, d)); close() }}
                    className={`mx-auto h-8 w-8 ${cellBtn} ${
                      isSel(d)
                        ? 'bg-green text-bg font-semibold'
                        : isToday(d)
                        ? 'text-green ring-1 ring-inset ring-green/40 hover:bg-card-hover'
                        : 'text-ink hover:bg-card-hover'
                    }`}
                  >
                    {d}
                  </button>
                )
              )}
            </div>
          )}

          {mode === 'months' && (
            <div className="grid grid-cols-3 gap-1.5">
              {MONTHS_SHORT.map((m, i) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setView((v) => ({ ...v, m: i })); setMode('days') }}
                  className={`h-9 ${cellBtn} ${
                    i === view.m ? 'bg-green text-bg font-semibold' : 'text-ink hover:bg-card-hover'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}

          {mode === 'years' && (
            <div className="grid grid-cols-3 gap-1.5">
              {Array.from({ length: 12 }, (_, i) => yearPage + i).map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => { setView((v) => ({ ...v, y })); setMode('months') }}
                  className={`h-9 ${cellBtn} ${
                    y === view.y ? 'bg-green text-bg font-semibold' : 'text-ink hover:bg-card-hover'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between border-t border-edge pt-2">
            <button type="button" onClick={() => { onChange?.(''); close() }} className="text-[11px] text-ink-faint hover:text-ink">
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                setView({ y: today.getFullYear(), m: today.getMonth() })
                setMode('days')
                onChange?.(toStr(today.getFullYear(), today.getMonth(), today.getDate()))
                close()
              }}
              className="text-[11px] text-green hover:text-green-bright"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </Popover>
  )
}
