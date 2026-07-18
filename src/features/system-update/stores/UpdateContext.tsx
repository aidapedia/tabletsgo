import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '@/features/auth'
import { checkForUpdate } from '../lib/api'
import type { UpdateInfo } from '../lib/types'

// App-wide update state: one silent check after login, exposed to the banner
// (HomeLayout) and the Settings > Updates panel. Per-version dismissal is
// remembered so a dismissed banner doesn't reappear until a newer version ships.

const DISMISS_KEY = 'dbm.update.dismissed'

type UpdateCtx = {
  info: UpdateInfo | null
  loading: boolean
  lastChecked: number | null
  check: (refresh?: boolean) => Promise<void>
  dismissed: boolean
  dismiss: () => void
}

const Ctx = createContext<UpdateCtx | null>(null)

export function UpdateProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth() as { user: unknown }
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastChecked, setLastChecked] = useState<number | null>(null)
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY)
    } catch {
      return null
    }
  })

  const check = useCallback(async (refresh = false) => {
    setLoading(true)
    try {
      const data = await checkForUpdate(refresh)
      setInfo(data)
      setLastChecked(Date.now())
    } finally {
      setLoading(false)
    }
  }, [])

  // One quiet check once authenticated (handles landing on an already-updated
  // image as well as a routine newer-release check).
  useEffect(() => {
    if (user && !info) check()
  }, [user, info, check])

  const dismiss = useCallback(() => {
    const v = info?.latest?.version
    if (!v) return
    try {
      localStorage.setItem(DISMISS_KEY, v)
    } catch {
      // Ignore storage failures — the banner just reappears next load.
    }
    setDismissedVersion(v)
  }, [info])

  const dismissed = !!info?.latest && dismissedVersion === info.latest.version

  const value = useMemo(
    () => ({ info, loading, lastChecked, check, dismissed, dismiss }),
    [info, loading, lastChecked, check, dismissed, dismiss],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useUpdate(): UpdateCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useUpdate must be used within UpdateProvider')
  return ctx
}
