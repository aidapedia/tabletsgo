/**
 * A person's theme — their "appearance" — as tabletsgo accepts it. One theme
 * per account, the same in every app they sign in to: in enterprise mode Hayat
 * stores and checks it (edited in Hayat's console); a solo instance stores its
 * owner's in the `solo` setting, checked here by the same rules Hayat applies
 * (hayat/internal/identity/appearance.go), so a theme moves between the two
 * unchanged when an instance joins a team.
 *
 * The shape is the proto3 JSON of hayat.*.v1.Appearance. Every field is
 * optional; an empty one means "the app's own default".
 *
 * A leaf: it imports nothing.
 */

const COLORS = [
  'accent', 'background', 'surface', 'text', 'muted', 'border',
  'sidebarBackground', 'sidebarText', 'sidebarActive', 'sidebarBorder',
  'success', 'warning', 'destructive',
]
const CHOICES = {
  mode: ['system', 'light', 'dark'],
  font: ['system', 'inter', 'plex'],
  density: ['comfortable', 'compact', 'condensed'],
  contentWidth: ['narrow', 'default', 'full'],
}
const RANGES = { textSize: [12, 18], radius: [0, 18], sidebarWidth: [200, 320] }
const HEX = /^#[0-9a-f]{6}$/
const PRESET = /^[a-z0-9-]{1,40}$/

const fail = (message) => Object.assign(new Error(message), { status: 400 })

/**
 * Check a theme and lower-case its colors. → the theme, or null when it sets
 * nothing (which goes back to every app's defaults). Throws a 400 naming the
 * first field no app could draw. Unknown fields are dropped.
 */
export function normalizeAppearance(raw) {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) throw fail('The appearance must be an object.')
  const out = {}
  for (const k of COLORS) {
    if (raw[k] === undefined || raw[k] === '') continue
    const c = String(raw[k]).trim().toLowerCase()
    if (!HEX.test(c)) throw fail(`The ${k} color must look like #1d6a54.`)
    out[k] = c
  }
  if (raw.preset !== undefined && raw.preset !== '') {
    if (!PRESET.test(String(raw.preset))) throw fail('The preset name may use lower-case letters, digits and dashes.')
    out.preset = String(raw.preset)
  }
  for (const [k, allowed] of Object.entries(CHOICES)) {
    if (raw[k] === undefined || raw[k] === '') continue
    if (!allowed.includes(raw[k])) throw fail(`${k} must be one of ${allowed.join(', ')}.`)
    out[k] = raw[k]
  }
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    if (raw[k] === undefined || raw[k] === null) continue
    const n = Number(raw[k])
    if (!Number.isInteger(n) || n < lo || n > hi) throw fail(`${k} must be between ${lo} and ${hi}.`)
    out[k] = n
  }
  if (raw.sidebarMatchContent === true) out.sidebarMatchContent = true
  return Object.keys(out).length ? out : null
}
