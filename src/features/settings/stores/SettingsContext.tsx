import { createContext, useContext, useState } from 'react'

const SettingsContext = createContext(null)
const KEY = 'tabletsgo:settings'

export const DEFAULT_TABLE_ROW_LIMIT = 50000
// Guardrails for the configurable limit.
export const MIN_TABLE_ROW_LIMIT = 1
export const MAX_TABLE_ROW_LIMIT = 1000000

const clampLimit = (n) => {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v) || v < MIN_TABLE_ROW_LIMIT) return DEFAULT_TABLE_ROW_LIMIT
  return Math.min(v, MAX_TABLE_ROW_LIMIT)
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { tableRowLimit: clampLimit(raw.tableRowLimit ?? DEFAULT_TABLE_ROW_LIMIT) }
  } catch {
    return { tableRowLimit: DEFAULT_TABLE_ROW_LIMIT }
  }
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(load)

  const update = (patch) =>
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      if ('tableRowLimit' in patch) next.tableRowLimit = clampLimit(patch.tableRowLimit)
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })

  const setTableRowLimit = (n) => update({ tableRowLimit: n })

  return (
    <SettingsContext.Provider value={{ ...settings, setTableRowLimit }}>{children}</SettingsContext.Provider>
  )
}

export const useSettings = () => useContext(SettingsContext)
