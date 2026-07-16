import { useEffect, useRef } from 'react'
import Popover from '@/shared/ui/overlay/Popover'
import { ClockIcon } from '@/shared/ui/icons'

// App-styled time picker. `value`/`onChange` speak plain 'HH:MM:SS' strings
// (empty string = no time) — a drop-in for the native <input type="time">.

const pad = (n) => String(n).padStart(2, '0')

function parse(value) {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value || '')
  if (!m) return { h: null, m: null, s: null }
  return { h: +m[1], m: +m[2], s: m[3] != null ? +m[3] : 0 }
}

const range = (n) => Array.from({ length: n }, (_, i) => i)

const triggerClass =
  'flex w-full items-center gap-2 px-3 py-2 bg-elevated border border-edge rounded-soft text-ink text-[11px] outline-none transition-[border-color,box-shadow] duration-150 hover:border-edge-strong'

// One scrollable column of zero-padded numbers; the selected value auto-centers
// when the panel opens.
function Column({ values, selected, onPick }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current?.querySelector('[data-selected="true"]')
    el?.scrollIntoView({ block: 'center' })
  }, [])
  return (
    <div ref={ref} className="flex-1 overflow-y-auto py-1">
      {values.map((v) => {
        const on = v === selected
        return (
          <button
            key={v}
            type="button"
            data-selected={on}
            onClick={() => onPick(v)}
            className={`flex w-full items-center justify-center py-1.5 text-[12px] transition-colors ${
              on ? 'bg-green text-bg font-semibold' : 'text-ink hover:bg-card-hover'
            }`}
          >
            {pad(v)}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The hour/minute/second columns on their own. Split out of TimePicker so other
 * controls (e.g. DateTimeField) can host them beneath a calendar. The host sets
 * the height via `className`.
 */
export function TimeColumns({ value = '', onChange, className = '' }) {
  const t = parse(value)
  const set = (h, m, s) => onChange?.(`${pad(h)}:${pad(m)}:${pad(s)}`)
  return (
    <div className={`flex divide-x divide-edge ${className}`}>
      <Column values={range(24)} selected={t.h} onPick={(h) => set(h, t.m ?? 0, t.s ?? 0)} />
      <Column values={range(60)} selected={t.m} onPick={(m) => set(t.h ?? 0, m, t.s ?? 0)} />
      <Column values={range(60)} selected={t.s} onPick={(s) => set(t.h ?? 0, t.m ?? 0, s)} />
    </div>
  )
}

export default function TimePicker({ value = '', onChange, autoFocus = false, className = '' }) {
  const t = parse(value)
  const label = t.h == null ? '' : `${pad(t.h)}:${pad(t.m)}:${pad(t.s)}`

  return (
    <Popover
      width={200}
      portal
      trigger={({ toggle }) => (
        <button type="button" autoFocus={autoFocus} onClick={toggle} className={`${triggerClass} ${className}`}>
          <span className={label ? 'text-ink' : 'text-ink-faint'}>{label || 'Select time'}</span>
          <ClockIcon className="ml-auto text-ink-faint" />
        </button>
      )}
    >
      {() => <TimeColumns value={value} onChange={onChange} className="h-[200px]" />}
    </Popover>
  )
}
