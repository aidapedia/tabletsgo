import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext(null)
const BASE_KEY = 'tabletsgo:theme'
const DENSITY_KEY = 'tabletsgo:density'
const ACCENT_KEY = 'tabletsgo:accent'

// Default accent — the app's signature green.
export const DEFAULT_ACCENT = '#6fcf6a'
const HEX = /^#[0-9a-fA-F]{6}$/

// Background bases. 'system' follows the OS; the others are concrete. The base
// only sets neutral surfaces/ink (see index.css) — the accent is independent.
export const BASES = ['system', 'light', 'dark']

// density: 'comfortable' | 'compact' | 'condensed' — maps to a class on <html>
// that overrides the root font-size (see index.css). Comfortable = no class.
export const DENSITIES = ['comfortable', 'compact', 'condensed']

// Map any stored value (incl. the legacy named palettes and 'light'/'dark') to
// a background base.
function normalizeBase(raw) {
  if (raw === 'light' || raw === 'white') return 'light'
  if (raw === 'system') return 'system'
  if (BASES.includes(raw)) return raw
  // 'dark' and every old dark palette (black/ocean/grape/ember/custom).
  return raw ? 'dark' : 'system'
}

// base → concrete surface ('light' | 'dark'), resolving 'system' against the OS.
function resolveBase(base) {
  if (base !== 'system') return base
  const sysDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  return sysDark ? 'dark' : 'light'
}

function applyBase(base) {
  const id = resolveBase(base)
  const root = document.documentElement
  // Dark is the default @theme palette, so only light needs a class.
  root.classList.toggle('theme-light', id === 'light')
  root.classList.toggle('light', id === 'light')
  root.classList.toggle('dark', id === 'dark')
}

function applyDensity(density) {
  const root = document.documentElement
  root.classList.toggle('density-compact', density === 'compact')
  root.classList.toggle('density-condensed', density === 'condensed')
}

export function ThemeProvider({ children }) {
  const [base, setBaseState] = useState(() => normalizeBase(localStorage.getItem(BASE_KEY)))
  const [density, setDensityState] = useState(
    () => localStorage.getItem(DENSITY_KEY) || 'comfortable',
  )
  const [accent, setAccentState] = useState(() => {
    const raw = localStorage.getItem(ACCENT_KEY)
    return raw && HEX.test(raw) ? raw : DEFAULT_ACCENT
  })

  useEffect(() => {
    applyBase(base)
    if (base !== 'system') return
    // Follow OS changes while on "system".
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyBase('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [base])

  useEffect(() => {
    applyDensity(density)
  }, [density])

  // The primary token derives from --accent (see index.css), so this recolors
  // the whole app regardless of the chosen background.
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent)
  }, [accent])

  const setBase = (b) => {
    localStorage.setItem(BASE_KEY, b)
    setBaseState(b)
  }

  const setDensity = (d) => {
    localStorage.setItem(DENSITY_KEY, d)
    setDensityState(d)
  }

  const setAccent = (c) => {
    if (!HEX.test(c)) return
    localStorage.setItem(ACCENT_KEY, c)
    setAccentState(c)
  }

  return (
    <ThemeContext.Provider value={{ base, setBase, density, setDensity, accent, setAccent }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
