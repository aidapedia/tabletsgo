import { createContext, useContext, useState } from 'react'

const SettingsContext = createContext(null)
const KEY = 'tabletsgo:settings'

export const DEFAULT_TABLE_ROW_LIMIT = 50000
// Guardrails for the configurable limit.
export const MIN_TABLE_ROW_LIMIT = 1
export const MAX_TABLE_ROW_LIMIT = 1000000

// Query execution timeout, in seconds. Aborts a running query once it elapses.
export const DEFAULT_QUERY_TIMEOUT = 30
export const MIN_QUERY_TIMEOUT = 1
export const MAX_QUERY_TIMEOUT = 3600

// When on, data/schema mutations run immediately instead of being staged in
// the Changes panel for a later commit.
export const DEFAULT_DIRECT_EXECUTE = false

const clampLimit = (n) => {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v) || v < MIN_TABLE_ROW_LIMIT) return DEFAULT_TABLE_ROW_LIMIT
  return Math.min(v, MAX_TABLE_ROW_LIMIT)
}

const clampTimeout = (n) => {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v) || v < MIN_QUERY_TIMEOUT) return DEFAULT_QUERY_TIMEOUT
  return Math.min(v, MAX_QUERY_TIMEOUT)
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return {
      tableRowLimit: clampLimit(raw.tableRowLimit ?? DEFAULT_TABLE_ROW_LIMIT),
      queryTimeout: clampTimeout(raw.queryTimeout ?? DEFAULT_QUERY_TIMEOUT),
      directExecute: !!(raw.directExecute ?? DEFAULT_DIRECT_EXECUTE),
    }
  } catch {
    return {
      tableRowLimit: DEFAULT_TABLE_ROW_LIMIT,
      queryTimeout: DEFAULT_QUERY_TIMEOUT,
      directExecute: DEFAULT_DIRECT_EXECUTE,
    }
  }
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(load)

  const update = (patch) =>
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      if ('tableRowLimit' in patch) next.tableRowLimit = clampLimit(patch.tableRowLimit)
      if ('queryTimeout' in patch) next.queryTimeout = clampTimeout(patch.queryTimeout)
      if ('directExecute' in patch) next.directExecute = !!patch.directExecute
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })

  const setTableRowLimit = (n) => update({ tableRowLimit: n })
  const setQueryTimeout = (n) => update({ queryTimeout: n })
  const setDirectExecute = (v) => update({ directExecute: v })

  return (
    <SettingsContext.Provider value={{ ...settings, setTableRowLimit, setQueryTimeout, setDirectExecute }}>
      {children}
    </SettingsContext.Provider>
  )
}

export const useSettings = () => useContext(SettingsContext)
