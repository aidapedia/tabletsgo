import { createContext, useContext, useState } from 'react'

const SettingsContext = createContext(null)
const KEY = 'tabletsgo:settings'

// Per-person preferences, kept in this browser. The table row limit and query
// timeout used to live here; they are instance policy now, set per engine by an
// instance admin (Admin → Modules — see `useEngineLimits` in features/modules).

// When on, data/schema mutations run immediately instead of being staged in
// the Changes panel for a later commit.
export const DEFAULT_DIRECT_EXECUTE = false

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { directExecute: !!(raw.directExecute ?? DEFAULT_DIRECT_EXECUTE) }
  } catch {
    return { directExecute: DEFAULT_DIRECT_EXECUTE }
  }
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(load)

  const update = (patch) =>
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      if ('directExecute' in patch) next.directExecute = !!patch.directExecute
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })

  const setDirectExecute = (v) => update({ directExecute: v })

  return <SettingsContext.Provider value={{ ...settings, setDirectExecute }}>{children}</SettingsContext.Provider>
}

export const useSettings = () => useContext(SettingsContext)
