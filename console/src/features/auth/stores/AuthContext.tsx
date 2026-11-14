import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { UserManager, type User } from 'oidc-client-ts'
import { setTokenSource } from '@/shared/api/request'
import { setDisplayTimeZone } from '@/shared/lib/datetime'
import {
  getAuthConfig,
  getMe,
  soloLogin,
  soloLogout,
  soloRefresh,
  soloSetup,
  type AuthConfig,
  type AuthUser,
  type SoloSetupInput,
  type SoloTokens,
} from '../api'

/**
 * Who is signed in, in either mode the server runs in (`GET /api/auth/config`).
 *
 * **Enterprise** — signing in happens at Hayat. The console is a public OpenID
 * client: authorization code + PKCE against Hayat's issuer, with the client id
 * the server hands out. Tokens live in sessionStorage, one set per tab; a tab
 * without one is sent through Hayat, which signs it in without a prompt while
 * the Hayat session lasts. Renewal is on demand and deduplicated: Hayat rotates
 * refresh tokens and revokes the whole family if one is presented twice.
 *
 * **Solo** — one owner, signed in by password on this instance. The access token
 * lives in memory only; the refresh token is an httpOnly cookie the server set,
 * so a reload (or a new tab) gets a fresh access token from it without asking.
 * The sign-in and first-run setup screens render in place (`RequireAuth`), so
 * signing in lands where the person was going.
 *
 * Either way every backend call gets `Authorization: Bearer` through the token
 * source registered with `shared/api/request`.
 */
type Status = 'loading' | 'signedIn' | 'signedOut' | 'setup' | 'unconfigured'

type Auth = {
  status: Status
  user: AuthUser | null
  config: AuthConfig | null
  // Hayat's account page (enterprise): name, password, time zone, sign-in methods.
  accountUrl: string | null
  signIn: (returnTo?: string) => Promise<void>
  // Back from Hayat: finish the code exchange; resolves to where to go next.
  completeSignIn: () => Promise<string>
  logout: () => Promise<void>
  // Solo: the owner's own sign-in, first-run setup, and taking tokens a route
  // handed back (a password change).
  soloSignIn: (email: string, password: string) => Promise<void>
  soloSetup: (input: SoloSetupInput) => Promise<void>
  applyTokens: (tokens: SoloTokens) => void
  reloadMe: () => Promise<void>
}

const AuthContext = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [accountUrl, setAccountUrl] = useState<string | null>(null)
  const refreshing = useRef<Promise<User | null> | null>(null)
  const redirecting = useRef(false)
  // Solo: the access token, kept in memory, and the renewal in flight.
  const solo = useRef<{ token: string | null; expires: number }>({ token: null, expires: 0 })
  const soloRenewing = useRef<Promise<string | null> | null>(null)
  const isSolo = config?.mode === 'solo'

  // During render on purpose: an effect would run after the children have
  // already formatted their times in the previous zone.
  setDisplayTimeZone(user?.timezone)

  const manager = useMemo(
    () =>
      config?.mode === 'enterprise' && config.issuer && config.clientId
        ? new UserManager({
            authority: config.issuer,
            client_id: config.clientId,
            redirect_uri: `${window.location.origin}/callback`,
            post_logout_redirect_uri: `${window.location.origin}/`,
            response_type: 'code',
            scope: 'openid profile email offline_access',
            automaticSilentRenew: false,
            loadUserInfo: false,
          })
        : null,
    [config],
  )

  const applyTokens = useCallback((t: SoloTokens) => {
    solo.current = { token: t.accessToken, expires: Date.now() + t.expiresIn * 1000 }
  }, [])

  // Solo: a fresh access token from the refresh cookie, one request at a time.
  const soloRenew = useCallback(async () => {
    soloRenewing.current ??= soloRefresh()
      .then((t) => {
        applyTokens(t)
        return t.accessToken
      })
      .catch(() => {
        solo.current = { token: null, expires: 0 }
        return null
      })
      .finally(() => {
        soloRenewing.current = null
      })
    return soloRenewing.current
  }, [applyTokens])

  // A valid access token, renewed first when it is about to lapse.
  const accessToken = useCallback(async () => {
    if (isSolo) {
      if (solo.current.token && solo.current.expires - Date.now() > 30_000) return solo.current.token
      return soloRenew()
    }
    if (!manager) return null
    const u = await manager.getUser()
    if (!u) return null
    if ((u.expires_in ?? 0) > 30) return u.access_token
    if (!u.refresh_token) return null
    refreshing.current ??= manager.signinSilent().finally(() => {
      refreshing.current = null
    })
    try {
      return (await refreshing.current)?.access_token ?? null
    } catch {
      return null
    }
  }, [isSolo, soloRenew, manager])

  useEffect(() => {
    setTokenSource(accessToken)
  }, [accessToken])

  const signIn = useCallback(
    async (returnTo?: string) => {
      // Solo signs in on the page itself (RequireAuth shows the form).
      if (!manager || redirecting.current) return
      redirecting.current = true
      await manager.signinRedirect({ state: { returnTo: returnTo ?? window.location.pathname + window.location.search } })
    },
    [manager],
  )

  const loadMe = useCallback(async () => {
    try {
      const me = await getMe()
      setUser(me.user)
      setAccountUrl(me.accountUrl)
      setStatus('signedIn')
    } catch {
      setUser(null)
      setStatus('signedOut')
    }
  }, [])

  // 1. Which mode, and where to sign in.
  useEffect(() => {
    getAuthConfig()
      .then((c) => {
        setConfig(c)
        if (c.mode === 'solo') {
          if (c.setupRequired) setStatus('setup')
        } else if (!c.issuer || !c.clientId) setStatus('unconfigured')
      })
      .catch(() => setStatus('unconfigured'))
  }, [])

  // 2. Already holding a token (a Hayat one in this tab, or solo's cookie)? Ask who it belongs to.
  useEffect(() => {
    if (!config || (config.mode === 'solo' && config.setupRequired)) return
    if (config.mode === 'enterprise' && (!manager || window.location.pathname === '/callback')) return
    void (async () => {
      if (await accessToken()) await loadMe()
      else setStatus('signedOut')
    })()
  }, [config, manager, accessToken, loadMe])

  // A call came back 401 with a token: it was revoked or the account changed.
  // Hayat: drop it and go back through Hayat, which signs straight back in if
  // its own session is still good. Solo: try the cookie once, else sign in.
  useEffect(() => {
    const onUnauthorized = () => {
      if (isSolo) {
        solo.current = { token: null, expires: 0 }
        void soloRenew().then((t) => {
          if (!t) {
            setUser(null)
            setStatus('signedOut')
          }
        })
        return
      }
      if (!manager) return
      void manager.removeUser().then(() => signIn())
    }
    window.addEventListener('auth:unauthorized', onUnauthorized)
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized)
  }, [isSolo, soloRenew, manager, signIn])

  const completeSignIn = useCallback(async () => {
    if (!manager) throw new Error('Sign-in is not configured')
    const u = await manager.signinRedirectCallback()
    await loadMe()
    const returnTo = (u.state as { returnTo?: string } | undefined)?.returnTo
    return returnTo && returnTo.startsWith('/') && !returnTo.startsWith('/callback') ? returnTo : '/'
  }, [manager, loadMe])

  const soloSignIn = useCallback(
    async (email: string, password: string) => {
      applyTokens(await soloLogin(email, password))
      await loadMe()
    },
    [applyTokens, loadMe],
  )

  const doSoloSetup = useCallback(
    async (input: SoloSetupInput) => {
      applyTokens(await soloSetup(input))
      setConfig((c) => (c?.mode === 'solo' ? { ...c, setupRequired: false } : c))
      await loadMe()
    },
    [applyTokens, loadMe],
  )

  const logout = useCallback(async () => {
    if (isSolo) {
      await soloLogout().catch(() => {})
      solo.current = { token: null, expires: 0 }
      setUser(null)
      setStatus('signedOut')
      return
    }
    if (!manager) return
    const u = await manager.getUser()
    redirecting.current = true
    await manager.removeUser()
    await manager.signoutRedirect({ id_token_hint: u?.id_token })
  }, [isSolo, manager])

  const value = useMemo(
    () => ({
      status,
      user,
      config,
      accountUrl,
      signIn,
      completeSignIn,
      logout,
      soloSignIn,
      soloSetup: doSoloSetup,
      applyTokens,
      reloadMe: loadMe,
    }),
    [status, user, config, accountUrl, signIn, completeSignIn, logout, soloSignIn, doSoloSetup, applyTokens, loadMe],
  )
  // Remount on a zone change: times already on screen were formatted in the old one.
  return (
    <AuthContext.Provider value={value}>
      <Fragment key={user?.timezone ?? ''}>{children}</Fragment>
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}

/**
 * Which mode the instance runs in, and whether there is anyone but the caller
 * to see. Gate member lists and access panels on `people` — a capability — not
 * on the mode's name. Hiding is all this does: the server enforces either way.
 */
export function useIdentity() {
  const { config } = useAuth()
  return { mode: config?.mode ?? null, people: config?.people ?? false, solo: config?.mode === 'solo' }
}
