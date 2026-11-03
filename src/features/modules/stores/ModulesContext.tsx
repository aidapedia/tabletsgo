import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '@/features/auth'
import { listModules, type PublicModule } from '../api'

/** The limits an instance admin sets per engine (Admin → Modules). */
export type EngineLimits = { queryTimeoutSec: number; tableRowLimit: number }

// The server's defaults (server/module-registry.js) — used only until
// /api/modules answers, or for an engine that has no such setting.
const DEFAULT_LIMITS: EngineLimits = { queryTimeoutSec: 30, tableRowLimit: 50000 }

type ModulesValue = {
  /** null until the first load (and while signed out). */
  modules: PublicModule[] | null
  /** Is this module on? Unknown, or not loaded yet, reads as on — the server refuses what's off either way. */
  isEnabled: (id: string) => boolean
  /** The query timeout and table row limit for a connection type. */
  limitsFor: (type?: string) => EngineLimits
  refresh: () => Promise<void>
}

const ModulesContext = createContext<ModulesValue>({
  modules: null,
  isEnabled: () => true,
  limitsFor: () => DEFAULT_LIMITS,
  refresh: async () => {},
})

/**
 * What this instance offers and how it's set: the connection type picker and
 * the Backup tabs hide what's off; the consoles read their query timeout and
 * the table view its row limit from here. Reloaded whenever the signed-in user
 * changes, and by Admin → Modules after a save.
 */
export function ModulesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [modules, setModules] = useState<PublicModule[] | null>(null)

  const refresh = useCallback(async () => {
    setModules(await listModules())
  }, [])

  useEffect(() => {
    if (user) refresh()
    else setModules(null)
  }, [user?.id, refresh])

  const value = useMemo<ModulesValue>(() => {
    const off = new Set((modules || []).filter((m) => !m.enabled).map((m) => m.id))
    const byId = new Map((modules || []).map((m) => [m.id, m]))
    return {
      modules,
      isEnabled: (id) => !off.has(id),
      limitsFor: (type) => ({ ...DEFAULT_LIMITS, ...(type ? byId.get(type)?.settings : null) }),
      refresh,
    }
  }, [modules, refresh])

  return <ModulesContext.Provider value={value}>{children}</ModulesContext.Provider>
}

export const useModules = () => useContext(ModulesContext)

/** Shorthand for `useModules().limitsFor(type)`. */
export const useEngineLimits = (type?: string) => useModules().limitsFor(type)
