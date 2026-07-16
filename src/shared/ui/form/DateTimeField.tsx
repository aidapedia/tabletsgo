import Popover from '@/shared/ui/overlay/Popover'
import { CalendarIcon, ClockIcon } from '@/shared/ui/icons'
import { CalendarPanel, todayStr } from '@/shared/ui/form/DatePicker'
import { TimeColumns } from '@/shared/ui/form/TimePicker'

/**
 * A date/time field that stays a plain string. The text is always editable —
 * the database column is a string and some values (functions, odd formats)
 * can only be typed — while the calendar/clock button opens a picker that
 * rewrites the same string. `kind` is 'date' | 'time' | 'datetime'.
 *
 * `value`/`onChange` speak the joined string ('YYYY-MM-DD HH:MM:SS' and its
 * date-only/time-only variants); an empty string means no value.
 */

const pad = (n) => String(n).padStart(2, '0')
const DATE_RE = /\d{4}-\d{2}-\d{2}/
const TIME_RE = /\d{2}:\d{2}(?::\d{2})?/

// Fractional seconds and/or a zone offset trailing the time ('.123+07', 'Z').
// Only ever read from just after the time, since a bare 'YYYY-MM-DD' ends in
// something that looks exactly like a '-06' offset.
const SUFFIX_RE = /^(\.\d+)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?/i

// Pull the date/time halves out of whatever the field currently holds. Text
// that parses as neither leaves both blank, so the picker just starts fresh
// instead of fighting the typed value.
const partsOf = (s) => {
  const d = DATE_RE.exec(s || '')
  const t = TIME_RE.exec(s || '')
  if (!t) return { date: d ? d[0] : '', time: '', suffix: '' }
  const m = SUFFIX_RE.exec(s.slice(t.index + t[0].length))
  return {
    date: d ? d[0] : '',
    time: t[0].length === 5 ? `${t[0]}:00` : t[0],
    // Carried through untouched: a timestamptz keeps its offset when only the
    // date or the clock time is picked.
    suffix: `${m?.[1] ?? ''}${m?.[2] ?? ''}`,
  }
}

const join = (kind, date, time, suffix = '') => {
  const clock = time ? `${time}${suffix}` : ''
  if (kind === 'date') return date
  if (kind === 'time') return clock
  return date ? (clock ? `${date} ${clock}` : date) : clock
}

const nowTime = () => {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const PLACEHOLDER = {
  date: 'YYYY-MM-DD',
  time: 'HH:MM:SS',
  datetime: 'YYYY-MM-DD HH:MM:SS',
}

export default function DateTimeField({
  kind = 'datetime',
  value = '',
  onChange,
  id = undefined,
  autoFocus = false,
  className = '',
}) {
  const parts = partsOf(value)
  const showDate = kind !== 'time'
  const showTime = kind !== 'date'
  const set = (date, time) => onChange?.(join(kind, date, time, parts.suffix))
  const Icon = showDate ? CalendarIcon : ClockIcon

  return (
    <Popover
      portal
      align="right"
      width={showDate ? 264 : 200}
      trigger={({ toggle }) => (
        <div
          className={`flex items-stretch overflow-hidden rounded-soft border border-edge bg-elevated transition-[border-color,box-shadow] duration-150 focus-within:border-green-dim focus-within:shadow-[0_0_0_3px_rgba(111,207,106,0.22)] ${className}`}
        >
          <input
            id={id}
            autoFocus={autoFocus}
            value={value}
            placeholder={PLACEHOLDER[kind]}
            onChange={(e) => onChange?.(e.target.value)}
            className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-[11px] text-ink outline-none placeholder:font-sans placeholder:text-ink-faint"
          />
          <button
            type="button"
            onClick={toggle}
            aria-label={showDate ? 'Pick a date' : 'Pick a time'}
            className="flex w-8 shrink-0 items-center justify-center border-l border-edge text-ink-dim transition-colors hover:bg-card-hover hover:text-ink"
          >
            <Icon width={14} height={14} />
          </button>
        </div>
      )}
    >
      {({ close }) => (
        <div>
          {showDate && (
            <div className="p-3">
              {/* Picking a day on a datetime leaves the panel open so the time
                  can be set in the same visit. */}
              <CalendarPanel
                value={parts.date}
                onChange={(d) => {
                  set(d, parts.time)
                  if (!showTime) close()
                }}
              />
            </div>
          )}
          {showTime && (
            <TimeColumns
              value={parts.time}
              onChange={(t) => set(parts.date, t)}
              className={`h-[168px] ${showDate ? 'border-t border-edge' : ''}`}
            />
          )}
          <div className="flex items-center justify-between border-t border-edge px-3 py-2">
            <button
              type="button"
              onClick={() => {
                onChange?.('')
                close()
              }}
              className="text-[11px] text-ink-faint hover:text-ink"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => onChange?.(join(kind, todayStr(), nowTime(), parts.suffix))}
              className="text-[11px] text-green hover:text-green-bright"
            >
              {kind === 'date' ? 'Today' : 'Now'}
            </button>
          </div>
        </div>
      )}
    </Popover>
  )
}
