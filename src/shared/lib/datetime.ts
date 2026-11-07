/**
 * Every time the app shows goes through here, so it reads in the zone the
 * signed-in person chose. Nothing else may call `toLocaleString` on a Date.
 *
 * The zone is module state rather than a hook because most formatters are plain
 * functions called from table columns and `lib/` helpers; `AuthProvider` sets it
 * from the account before anything below it renders.
 *
 * This is for moments the app recorded. A value read out of someone's own
 * database stays exactly as stored: `DataGrid` and `DateTimeField` don't use it.
 */
type When = number | string | Date

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

// undefined = the browser's own zone.
let zone: string | undefined

export const isTimeZone = (candidate: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: candidate })
    return true
  } catch {
    return false
  }
}

// A zone this browser can't format would make every formatter below throw, so
// one saved on a newer browser falls back rather than taking the page down.
export function setDisplayTimeZone(next?: string | null) {
  zone = next && isTimeZone(next) ? next : undefined
}

export const displayTimeZone = () => zone || browserZone()

export const formatDateTime = (when: When, options?: Intl.DateTimeFormatOptions) =>
  new Date(when).toLocaleString(undefined, { ...options, timeZone: zone })

export const formatDate = (when: When, options?: Intl.DateTimeFormatOptions) =>
  new Date(when).toLocaleDateString(undefined, { ...options, timeZone: zone })

export const formatTime = (when: When, options?: Intl.DateTimeFormatOptions) =>
  new Date(when).toLocaleTimeString(undefined, { ...options, timeZone: zone })

export const isSameDay = (a: When, b: When) => formatDate(a) === formatDate(b)

// The wall clock in `tz` at this instant, written as if it were UTC.
function wallClockMs(at: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at)
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'))
}

/**
 * A `datetime-local` input's value ("2026-11-04T09:30") as the instant it means
 * in the display zone. `new Date(value)` would read it in the browser's zone.
 *
 * The offset is taken twice because it can differ either side of a clock change:
 * the first guess lands near the right instant, the second reads the offset there.
 */
export function zonedInputToDate(value: string) {
  const wall = new Date(`${value}Z`).getTime()
  const tz = displayTimeZone()
  const offsetAt = (at: number) => wallClockMs(at, tz) - at
  return new Date(wall - offsetAt(wall - offsetAt(wall)))
}

export function listTimeZones() {
  const supported: string[] = (Intl as any).supportedValuesOf?.('timeZone') ?? [browserZone()]
  return supported.includes('UTC') ? supported : ['UTC', ...supported]
}

/** "GMT+7", for naming a zone beside its city. */
export const timeZoneOffset = (tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
    .formatToParts(Date.now())
    .find((p) => p.type === 'timeZoneName')?.value ?? ''
