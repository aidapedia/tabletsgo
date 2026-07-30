/**
 * Small helpers with no dependencies of their own, shared across the server.
 */

// Parse a JSON column that may be malformed, already-parsed, or NULL. Always
// returns something object-shaped so callers can read straight through it.
export const safeJson = (s) => {
  try {
    return typeof s === 'string' ? JSON.parse(s) : s || {}
  } catch {
    return {}
  }
}

// Bound a value for a JSON response: keep it structured when small, else a
// truncated string.
export function jsonPreview(v, max = 800) {
  let s
  try {
    s = JSON.stringify(v)
  } catch {
    s = String(v)
  }
  if (s === undefined) return null
  return s.length > max ? s.slice(0, max) + '… (truncated)' : v
}

// The AWS SDK's undici-based HTTP handler throws an AggregateError with an
// empty `.message` for connection failures (ECONNREFUSED, DNS, TLS, …) — fall
// back to `.code` or the first aggregated error so callers see something useful.
export const describeError = (err) => err.message || err.code || err.errors?.[0]?.message || String(err)

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Make a string safe to use as an object-storage key segment.
export const sanitizeForKey = (s) => String(s || 'connection').replace(/[^a-zA-Z0-9._-]+/g, '-')

// Next epoch-ms this frequency should fire, in UTC. Hourly: top of the next
// hour. Daily: the next occurrence of hourOfDay (today if not yet passed).
export function computeNextRun(frequency, hourOfDay, from = Date.now()) {
  const d = new Date(from)
  if (frequency === 'hourly') {
    d.setUTCMinutes(0, 0, 0)
    d.setUTCHours(d.getUTCHours() + 1)
    return d.getTime()
  }
  d.setUTCHours(hourOfDay || 0, 0, 0, 0)
  if (d.getTime() <= from) d.setUTCDate(d.getUTCDate() + 1)
  return d.getTime()
}
