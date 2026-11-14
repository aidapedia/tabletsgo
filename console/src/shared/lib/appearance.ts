/**
 * A person's theme — their "appearance": one per account, shared by every app
 * that signs them in. In enterprise mode it is stored in Hayat (edited in
 * Hayat's console, read by services through DirectoryService.GetUserAppearance);
 * a solo tabletsgo stores its owner's itself. The shape is the proto3 JSON of
 * hayat.*.v1.Appearance, end to end.
 *
 * Every field is optional, and an empty one means "this app's own default". So
 * an account that never chose anything looks the way each app ships, Mode
 * alone switches to each app's own light or dark palette, and only what the
 * person changed travels from app to app.
 *
 * This file is kept identical in tabletsgo's and Hayat's consoles: it knows
 * colors and sizes, never an app's CSS. Each app's theme provider maps
 * `themeTokens` onto its own custom properties.
 */

export type Mode = 'system' | 'light' | 'dark'
export type Resolved = 'light' | 'dark'
export type Density = 'comfortable' | 'compact' | 'condensed'
export type Font = 'system' | 'inter' | 'plex'
export type ContentWidth = 'narrow' | 'default' | 'full'

export const CONTENT_COLORS = ['background', 'surface', 'text', 'muted', 'border'] as const
export const SIDEBAR_COLORS = ['sidebarBackground', 'sidebarText', 'sidebarActive', 'sidebarBorder'] as const
export const STATUS_COLORS = ['success', 'warning', 'destructive'] as const
export const COLOR_KEYS = ['accent', ...CONTENT_COLORS, ...SIDEBAR_COLORS, ...STATUS_COLORS] as const
export type ColorKey = (typeof COLOR_KEYS)[number]

export type Look = Partial<Record<ColorKey, string>> & {
  preset?: string
  mode?: Mode
  sidebarMatchContent?: boolean
  font?: Font
  textSize?: number
  density?: Density
  radius?: number
  sidebarWidth?: number
  contentWidth?: ContentWidth
}

/** Every color, filled in: an app's defaults for a mode, or a look laid over them. */
export type Palette = Record<ColorKey, string>

/** What an app looks like when the person changed nothing. */
export type AppDefaults = {
  light: Palette
  dark: Palette
  textSize: number
  radius: number
  sidebarWidth: number
  /** Pixels; `full` is no limit. */
  contentWidth: number
}

export const LIMITS = { textSize: [12, 18], radius: [0, 18], sidebarWidth: [200, 320] } as const
export const MODES: Mode[] = ['system', 'light', 'dark']
export const DENSITIES: Density[] = ['comfortable', 'compact', 'condensed']
export const FONTS: Font[] = ['system', 'inter', 'plex']
export const CONTENT_WIDTHS: ContentWidth[] = ['narrow', 'default', 'full']

const HEX = /^#[0-9a-f]{6}$/
const PRESET = /^[a-z0-9-]{1,40}$/

// ---- Presets ------------------------------------------------------------------------

export type Preset = { id: string; name: string; mode: Resolved; colors: Palette }

const p = (id: string, name: string, mode: Resolved, c: string[]): Preset => ({
  id,
  name,
  mode,
  colors: Object.fromEntries(COLOR_KEYS.map((k, i) => [k, c[i]])) as Palette,
})

// accent, background, surface, text, muted, border, sidebar bg/text/active/border, success, warning, destructive
export const PRESETS: Preset[] = [
  p('tg-dark', 'tabletsgo Dark', 'dark', ['#6fcf6a', '#080808', '#101010', '#f4f4f5', '#a1a1aa', '#222222', '#0c0c0c', '#f4f4f5', '#1b1b1b', '#222222', '#22c55e', '#d6a73a', '#ef4444']),
  p('tg-light', 'tabletsgo Light', 'light', ['#2f9e44', '#ffffff', '#ffffff', '#16181c', '#555b63', '#e3e6e3', '#f6f7f6', '#16181c', '#eceeec', '#e3e6e3', '#16a34a', '#b8860b', '#e03131']),
  p('hayat-light', 'Hayat Light', 'light', ['#1d6a54', '#ffffff', '#ffffff', '#16181c', '#555b63', '#e3e6e3', '#f6f7f6', '#16181c', '#eceeec', '#e3e6e3', '#16a34a', '#b8860b', '#e03131']),
  p('hayat-dark', 'Hayat Dark', 'dark', ['#3fae86', '#080a09', '#101413', '#f2f5f3', '#a3aea8', '#222a27', '#0c0f0e', '#f2f5f3', '#1b2120', '#222a27', '#22c55e', '#d6a73a', '#ef5350']),
  p('slate-rail', 'Slate Rail', 'light', ['#2563eb', '#f7f8fa', '#ffffff', '#111827', '#4b5563', '#e5e7eb', '#0f172a', '#e2e8f0', '#1e293b', '#0f172a', '#16a34a', '#b45309', '#dc2626']),
  p('midnight', 'Midnight', 'dark', ['#7aa2ff', '#0b1020', '#121a2e', '#e6ebf5', '#9aa6bf', '#1f2a44', '#080c18', '#e6ebf5', '#1a2440', '#1f2a44', '#34d399', '#fbbf24', '#f87171']),
  p('paper', 'Paper', 'light', ['#0e7490', '#faf8f3', '#ffffff', '#1f1b16', '#5f584f', '#e7e1d6', '#f2ede3', '#1f1b16', '#e7e0d2', '#e2dacb', '#15803d', '#a16207', '#b91c1c']),
  p('contrast', 'High Contrast', 'dark', ['#ffd400', '#000000', '#000000', '#ffffff', '#d4d4d4', '#ffffff', '#000000', '#ffffff', '#262626', '#ffffff', '#4ade80', '#facc15', '#ff6b6b']),
]

export const SWATCHES = ['#6fcf6a', '#3fae86', '#1d6a54', '#0e7490', '#2563eb', '#7aa2ff', '#8b5cf6', '#e5484d', '#f59e0b', '#ffd400']

/** A preset as a look: every color set, sizes left as they were. */
export const fromPreset = (preset: Preset, keep: Look = {}): Look => ({
  ...sizesOf(keep),
  preset: preset.id,
  mode: preset.mode,
  ...preset.colors,
})

/** Just the sizes and font of a look. */
export const sizesOf = (l: Look): Look => {
  const out: Look = {}
  for (const k of ['font', 'textSize', 'density', 'radius', 'sidebarWidth', 'contentWidth'] as const) {
    if (l[k] !== undefined) (out as Record<string, unknown>)[k] = l[k]
  }
  return out
}

/**
 * Switch the mode: the neutral and status colors go back to this app's own for
 * that mode (that's what "dark" means in each app), the accent and sizes stay.
 */
export function withMode(l: Look, mode: Mode): Look {
  const out: Look = { ...l, mode, preset: 'custom' }
  for (const k of [...CONTENT_COLORS, ...SIDEBAR_COLORS, ...STATUS_COLORS]) delete out[k]
  return out
}

// ---- Validation -------------------------------------------------------------------------

const inRange = (v: unknown, [lo, hi]: readonly [number, number]) =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined
const pick = <T extends string>(v: unknown, allowed: readonly T[]) => (allowed.includes(v as T) ? (v as T) : undefined)

/**
 * Whatever arrived (the server, a file someone imported) as a look, keeping
 * only what an app can draw. Null when nothing is left.
 */
export function normalizeLook(raw: unknown): Look | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out: Look = {}
  for (const k of COLOR_KEYS) {
    const c = typeof r[k] === 'string' ? (r[k] as string).trim().toLowerCase() : ''
    if (HEX.test(c)) out[k] = c
  }
  if (typeof r.preset === 'string' && PRESET.test(r.preset)) out.preset = r.preset
  out.mode = pick(r.mode, MODES)
  if (r.sidebarMatchContent === true) out.sidebarMatchContent = true
  out.font = pick(r.font, FONTS)
  out.textSize = inRange(r.textSize, LIMITS.textSize)
  out.density = pick(r.density, DENSITIES)
  out.radius = inRange(r.radius, LIMITS.radius)
  out.sidebarWidth = inRange(r.sidebarWidth, LIMITS.sidebarWidth)
  out.contentWidth = pick(r.contentWidth, CONTENT_WIDTHS)
  for (const k of Object.keys(out) as (keyof Look)[]) if (out[k] === undefined) delete out[k]
  return Object.keys(out).length ? out : null
}

// ---- Color math ------------------------------------------------------------------------

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) || 0)
const toHex = (a: number[]) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')

/** `a` moved `w` of the way toward `b`. */
export const mix = (a: string, b: string, w: number) => {
  const x = rgb(a)
  const y = rgb(b)
  return toHex(x.map((v, i) => v + (y[i] - v) * w))
}

const luminance = (h: string) =>
  rgb(h).reduce((sum, v, i) => {
    const c = v / 255
    return sum + (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)) * [0.2126, 0.7152, 0.0722][i]
  }, 0)

/** WCAG contrast ratio, 1–21. */
export function contrast(a: string, b: string) {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Black or white, whichever reads better on `bg`. */
export const textOn = (bg: string) => (contrast(bg, '#ffffff') >= contrast(bg, '#0b0b0b') ? '#ffffff' : '#0b0b0b')

/** `c` as text on `on`: itself when it reads, else nudged toward `text` until it does. */
export function ink(c: string, on: string, text: string) {
  for (const w of [0, 0.35, 0.65]) {
    const v = mix(c, text, w)
    if (contrast(v, on) >= 4.5) return v
  }
  return text
}

// ---- What it adds up to ------------------------------------------------------------------

export const resolveMode = (l: Look | null, systemDark: boolean): Resolved =>
  l?.mode === 'light' || l?.mode === 'dark' ? l.mode : systemDark ? 'dark' : 'light'

/** Every color, after the look is laid over the app's defaults for the mode. */
export function paletteOf(l: Look | null, defaults: AppDefaults, resolved: Resolved): Palette {
  const out = { ...defaults[resolved] }
  for (const k of COLOR_KEYS) if (l?.[k]) out[k] = l[k]!
  if (l?.sidebarMatchContent) {
    out.sidebarBackground = mix(out.background, out.text, 0.03)
    out.sidebarText = out.text
    out.sidebarActive = mix(out.background, out.text, 0.09)
    out.sidebarBorder = out.border
  }
  return out
}

/**
 * The design tokens an app paints with. A key is left out when the look
 * doesn't touch it, so the app's stylesheet keeps answering for it.
 *
 *   primary…ring       the accent and what sits on it
 *   background…panel   the content area (`panel`: a slightly lifted surface)
 *   nav…navPrimary     navigation only — sidebar, icon rail, side panels
 *   success…           status colors
 */
export type TokenKey =
  | 'primary' | 'primaryForeground' | 'ring'
  | 'background' | 'foreground' | 'card' | 'popover' | 'secondary' | 'muted' | 'accent'
  | 'mutedForeground' | 'faint' | 'border' | 'input' | 'panel'
  | 'nav' | 'navForeground' | 'navMuted' | 'navFaint' | 'navActive' | 'navBorder' | 'navPrimary'
  | 'success' | 'warning' | 'destructive'

export function themeTokens(l: Look | null, defaults: AppDefaults, resolved: Resolved): Partial<Record<TokenKey, string>> {
  if (!l) return {}
  const c = paletteOf(l, defaults, resolved)
  const t: Partial<Record<TokenKey, string>> = {}
  if (l.accent) {
    t.primary = c.accent
    t.ring = c.accent
    t.primaryForeground = textOn(c.accent)
  }
  if (CONTENT_COLORS.some((k) => l[k])) {
    Object.assign(t, {
      background: c.background,
      foreground: c.text,
      card: c.surface,
      popover: c.surface,
      secondary: mix(c.background, c.text, 0.06),
      muted: mix(c.background, c.text, 0.06),
      accent: mix(c.background, c.text, 0.09),
      mutedForeground: c.muted,
      faint: mix(c.muted, c.background, 0.35),
      border: c.border,
      input: mix(c.border, c.text, 0.12),
      panel: mix(c.background, c.text, 0.03),
    })
  }
  if (l.sidebarMatchContent || SIDEBAR_COLORS.some((k) => l[k])) {
    Object.assign(t, {
      nav: c.sidebarBackground,
      navForeground: c.sidebarText,
      navMuted: mix(c.sidebarText, c.sidebarBackground, 0.3),
      navFaint: mix(c.sidebarText, c.sidebarBackground, 0.48),
      navActive: c.sidebarActive,
      navBorder: c.sidebarBorder,
      navPrimary: ink(c.accent, c.sidebarActive, c.sidebarText),
    })
  }
  for (const k of STATUS_COLORS) if (l[k]) t[k] = c[k]
  return t
}

const DENSITY_SCALE: Record<Density, number> = { comfortable: 1, compact: 0.85, condensed: 0.72 }
const FONT_STACKS: Record<Font, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  inter: '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  plex: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
}

/** Sizes and the font, as CSS values. Left out when the look doesn't set them. */
export function sizeTokens(l: Look | null) {
  const out: { fontSize?: string; spacing?: string; radius?: string; sidebarWidth?: string; contentWidth?: string; fontFamily?: string } = {}
  if (!l) return out
  if (l.textSize) out.fontSize = `${l.textSize}px`
  if (l.density && l.density !== 'comfortable') out.spacing = `calc(0.25rem * ${DENSITY_SCALE[l.density]})`
  if (l.radius !== undefined) out.radius = `${l.radius}px`
  if (l.sidebarWidth) out.sidebarWidth = `${l.sidebarWidth}px`
  if (l.contentWidth) out.contentWidth = l.contentWidth === 'full' ? 'none' : l.contentWidth === 'narrow' ? '960px' : ''
  if (l.font) out.fontFamily = FONT_STACKS[l.font]
  return out
}

// ---- Readability -----------------------------------------------------------------------

export type Check = { label: string; fg: string; bg: string; ratio: number; min: number; grade: string }

/** The pairs people read, against WCAG: 4.5:1 for text, 3:1 for the accent as a control. */
export function readability(c: Palette): Check[] {
  const mk = (label: string, fg: string, bg: string, min: number): Check => {
    const ratio = contrast(fg, bg)
    const grade = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? (min === 3 ? 'AA' : 'Large only') : 'Low'
    return { label, fg, bg, ratio, min, grade }
  }
  return [
    mk('Text on background', c.text, c.background, 4.5),
    mk('Muted text on background', c.muted, c.background, 4.5),
    mk('Text on surface', c.text, c.surface, 4.5),
    mk('Sidebar text', c.sidebarText, c.sidebarBackground, 4.5),
    mk('Text on accent', textOn(c.accent), c.accent, 4.5),
    mk('Accent on background', c.accent, c.background, 3),
  ]
}
