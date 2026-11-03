import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '@/features/auth'
import { checkForUpdate, getVersion } from '../lib/api'
import type { AppIdentity, UpdateInfo } from '../lib/types'

// App-wide update state: one silent check after login (when auto-check is on),
// exposed to the banner (HomeLayout) and the Settings > Updates panel.
// Per-version dismissal is remembered so a dismissed banner doesn't reappear
// until a newer version ships. Auto-check is off unless turned on in the
// Settings toggle (per browser) — so orchestrator-managed deployments (e.g.
// Coolify) don't poll GitHub on every sign-in. Manual "Check for updates"
// always works regardless.

const DISMISS_KEY = 'dbm.update.dismissed'
const AUTOCHECK_KEY = 'dbm.update.autocheck'

type UpdateCtx = {
  info: UpdateInfo | null
  // The running build, from the local /system/version endpoint. Always known
  // once authenticated — even when auto-check is off and `info` is still null.
  identity: AppIdentity | null
  loading: boolean
  lastChecked: number | null
  check: (refresh?: boolean) => Promise<void>
  dismissed: boolean
  dismiss: () => void
  autoCheck: boolean
  setAutoCheck: (next: boolean) => void
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
  // Per-browser auto-check preference; off until the Settings toggle turns it on.
  const [autoCheck, setAutoCheckState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTOCHECK_KEY) === 'on'
    } catch {
      return false
    }
  })
  const [identity, setIdentity] = useState<AppIdentity | null>(null)

  const setAutoCheck = useCallback((next: boolean) => {
    try {
      localStorage.setItem(AUTOCHECK_KEY, next ? 'on' : 'off')
    } catch {
      // Ignore storage failures — preference just won't persist across reloads.
    }
    setAutoCheckState(next)
  }, [])

  // Load the running build's identity once authenticated (cheap, local
  // endpoint — it doesn't hit GitHub, so it's safe even when auto-check is off).
  useEffect(() => {
    if (!user) return
    let cancelled = false
    getVersion().then((v) => {
      if (cancelled) return
      // safeRequest's fallback ('0.0.0') means the endpoint didn't answer —
      // don't pass that off as the running version.
      setIdentity(v.version === '0.0.0' ? null : v)
    })
    return () => {
      cancelled = true
    }
  }, [user])

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
  // image as well as a routine newer-release check). Runs only while auto-check
  // is on; flipping the toggle on later triggers a check via the autoCheck dep.
  useEffect(() => {
    if (user && autoCheck && !info) check()
  }, [user, autoCheck, info, check])

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
    () => ({ info, identity, loading, lastChecked, check, dismissed, dismiss, autoCheck, setAutoCheck }),
    [info, identity, loading, lastChecked, check, dismissed, dismiss, autoCheck, setAutoCheck],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useUpdate(): UpdateCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useUpdate must be used within UpdateProvider')
  return ctx
}
