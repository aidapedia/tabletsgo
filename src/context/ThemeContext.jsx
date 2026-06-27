import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext(null)
const KEY = 'tabletsgo:theme'

// theme: 'light' | 'dark' | 'system'
function applyTheme(theme) {
  const sysDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  const effective = theme === 'system' ? (sysDark ? 'dark' : 'light') : theme
  const root = document.documentElement
  root.classList.toggle('light', effective === 'light')
  root.classList.toggle('dark', effective === 'dark')
  return effective
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => localStorage.getItem(KEY) || 'system')

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    // Follow OS changes while on "system".
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = (t) => {
    localStorage.setItem(KEY, t)
    setThemeState(t)
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
