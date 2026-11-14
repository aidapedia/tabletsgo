import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { request } from '@/shared/api/request'
import {
  normalizeLook,
  resolveMode,
  sizeTokens,
  themeTokens,
  type AppDefaults,
  type Look,
  type Resolved,
  type TokenKey,
} from '@/shared/lib/appearance'

/**
 * The person's theme, applied to the whole app.
 *
 * A theme is the account's — one for every app they sign in to — so it comes
 * from `GET /api/me/appearance` once someone is signed in (`AppearanceSync`,
 * inside the auth provider). In enterprise mode that is Hayat's answer and is
 * edited in Hayat's console; in solo mode the owner edits it in Setting →
 * Appearance. Either way the server answers fresh on every page load.
 *
 * The last theme applied is remembered in this browser only to paint the first
 * frame (the sign-in page, the moment before the account answers); the
 * account's answer always replaces it.
 */

/** tabletsgo as it ships — index.css's two palettes, the 16px root, 0.625rem corners, the 16.5rem sidebar. */
export const DEFAULTS: AppDefaults = {
  dark: {
    accent: '#6fcf6a', background: '#080808', surface: '#101010', text: '#f4f4f5', muted: '#a1a1aa', border: '#222222',
    sidebarBackground: '#0c0c0c', sidebarText: '#f4f4f5', sidebarActive: '#1b1b1b', sidebarBorder: '#222222',
    success: '#22c55e', warning: '#d6a73a', destructive: '#ef4444',
  },
  light: {
    accent: '#6fcf6a', background: '#ffffff', surface: '#ffffff', text: '#16181c', muted: '#555b63', border: '#e3e6e3',
    sidebarBackground: '#f6f7f6', sidebarText: '#16181c', sidebarActive: '#eceeec', sidebarBorder: '#e3e6e3',
    success: '#16a34a', warning: '#b8860b', destructive: '#e03131',
  },
  textSize: 16,
  radius: 10,
  sidebarWidth: 264,
  contentWidth: 1280,
}

// Each design token → the custom properties in index.css it fills. The primary
// derives from --brand there; `panel` is --sidebar, which tabletsgo uses as a
// lifted surface all over; navigation reads the --nav-* set (`.app-sidebar`).
const VARS: Record<TokenKey, string[]> = {
  primary: ['--brand'],
  primaryForeground: ['--primary-foreground', '--sidebar-primary-foreground'],
  ring: [],
  background: ['--background'],
  foreground: ['--foreground', '--card-foreground', '--popover-foreground', '--secondary-foreground', '--accent-foreground'],
  card: ['--card'],
  popover: ['--popover'],
  secondary: ['--secondary'],
  muted: ['--muted'],
  accent: ['--accent'],
  mutedForeground: ['--muted-foreground'],
  faint: ['--faint'],
  border: ['--border'],
  input: ['--input'],
  panel: ['--sidebar'],
  nav: ['--nav', '--nav-background'],
  navForeground: ['--nav-foreground'],
  navMuted: ['--nav-muted'],
  navFaint: ['--nav-faint'],
  navActive: ['--nav-accent', '--nav-muted-bg'],
  navBorder: ['--nav-border', '--nav-input'],
  navPrimary: ['--nav-primary'],
  success: ['--success'],
  warning: ['--warning'],
  destructive: ['--destructive'],
}
const COLOR_VARS = [...new Set(Object.values(VARS).flat())]

const HINT_KEY = 'tabletsgo:appearance'
// The per-browser settings this replaced.
const LEGACY_KEYS = ['tabletsgo:theme', 'tabletsgo:density', 'tabletsgo:accent']

function readHint(): Look | null {
  try {
    for (const k of LEGACY_KEYS) localStorage.removeItem(k)
    return normalizeLook(JSON.parse(localStorage.getItem(HINT_KEY) || 'null'))
  } catch {
    return null
  }
}

function writeHint(look: Look | null) {
  try {
    if (look) localStorage.setItem(HINT_KEY, JSON.stringify(look))
    else localStorage.removeItem(HINT_KEY)
  } catch {
    /* a browser refusing storage just paints the defaults first */
  }
}

// Self-hosted, and fetched only when someone picks them.
function loadFont(font: Look['font']) {
  if (font === 'inter') void import('@fontsource-variable/inter')
  if (font === 'plex') {
    void import('@fontsource/ibm-plex-sans/400.css')
    void import('@fontsource/ibm-plex-sans/500.css')
    void import('@fontsource/ibm-plex-sans/600.css')
    void import('@fontsource/ibm-plex-sans/700.css')
  }
}

function setVar(name: string, value: string | undefined) {
  const style = document.documentElement.style
  if (value) style.setProperty(name, value)
  else style.removeProperty(name)
}

/** Paint a look: the light/dark class, then every token it sets (and none it doesn't). */
function apply(look: Look | null, resolved: Resolved) {
  const root = document.documentElement
  root.classList.toggle('light', resolved === 'light')
  root.classList.toggle('dark', resolved === 'dark')

  const tokens = themeTokens(look, DEFAULTS, resolved)
  const values = new Map<string, string>()
  for (const [key, names] of Object.entries(VARS) as [TokenKey, string[]][]) {
    const v = tokens[key]
    if (v) for (const n of names) values.set(n, v)
  }
  for (const n of COLOR_VARS) setVar(n, values.get(n))

  // The root font size is what every rem scales with; --spacing is Tailwind's
  // spacing step; the font is set on <html> because Tailwind inlines --font-sans.
  const s = sizeTokens(look)
  root.style.fontSize = s.fontSize || ''
  root.style.fontFamily = s.fontFamily || ''
  setVar('--spacing', s.spacing)
  setVar('--radius', s.radius)
  setVar('--app-sidebar-width', s.sidebarWidth)
  setVar('--app-content-width', s.contentWidth)
  loadFont(look?.font)
}

export type AppearanceAnswer = { appearance: unknown; editable?: boolean; editUrl?: string | null }

type ThemeContextValue = {
  /** What is showing: the account's theme, or one being previewed. */
  look: Look | null
  /** The account's theme. */
  saved: Look | null
  resolved: Resolved
  systemDark: boolean
  /** The account has answered. */
  loaded: boolean
  /** It's edited here (solo), not in Hayat. */
  editable: boolean
  /** Where it's edited instead. */
  editUrl: string | null
  /** Why the account's theme couldn't be read, if it couldn't. */
  error: string | null
  /** Bumped by `retry`. */
  attempt: number
  fail: (message: string) => void
  retry: () => void
  /** Show a theme without saving it; `undefined` goes back to the saved one. */
  preview: (look: Look | null | undefined) => void
  save: (look: Look | null) => Promise<void>
  receive: (answer: AppearanceAnswer) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const prefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<Look | null>(readHint)
  const [draft, setDraft] = useState<Look | null | undefined>(undefined)
  const [meta, setMeta] = useState({ loaded: false, editable: false, editUrl: null as string | null, error: null as string | null })
  // Bumped by `retry`; AppearanceSync asks the account again when it changes.
  const [attempt, setAttempt] = useState(0)
  const [systemDark, setSystemDark] = useState(prefersDark)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = () => setSystemDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const look = draft === undefined ? saved : draft
  const resolved = resolveMode(look, systemDark)

  useEffect(() => apply(look, resolved), [look, resolved])

  const keep = useCallback((answer: unknown) => {
    const next = normalizeLook(answer)
    setSaved(next)
    writeHint(next)
    return next
  }, [])

  const receive = useCallback(
    (answer: AppearanceAnswer) => {
      keep(answer.appearance)
      setMeta({ loaded: true, editable: !!answer.editable, editUrl: answer.editUrl || null, error: null })
    },
    [keep],
  )

  // The account couldn't be asked: keep painting what we have, and say so
  // where the theme is shown instead of waiting forever.
  const fail = useCallback((message: string) => setMeta((m) => ({ ...m, loaded: true, error: message || 'Couldn’t load your theme.' })), [])
  const retry = useCallback(() => {
    setMeta((m) => ({ ...m, loaded: false, error: null }))
    setAttempt((n) => n + 1)
  }, [])

  const save = useCallback(
    async (next: Look | null) => {
      const res = await request<{ appearance: unknown }>('/me/appearance', { method: 'PUT', body: { appearance: next } })
      keep(res.appearance)
      setDraft(undefined)
    },
    [keep],
  )

  const value = useMemo(
    () => ({ look, saved, resolved, systemDark, ...meta, attempt, preview: setDraft, save, receive, fail, retry }),
    [look, saved, resolved, systemDark, meta, attempt, save, receive, fail, retry],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme outside ThemeProvider')
  return ctx
}
