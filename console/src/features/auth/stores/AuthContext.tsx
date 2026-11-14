import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { UserManager, type User } from 'oidc-client-ts'
import { setTokenSource } from '@/shared/api/request'
import { setDisplayTimeZone } from '@/shared/lib/datetime'
import { getAuthConfig, getMe, type AuthConfig, type AuthUser } from '../api'

/**
 * Signing in happens at Hayat. The console is a public OpenID client:
 * authorization code + PKCE against Hayat's issuer, with the client id the
 * server hands out (`GET /api/auth/config`). Tokens live in sessionStorage, one
 * set per tab; a tab without one is sent through Hayat, which signs it in
 * without a prompt while the Hayat session lasts.
 *
 * Renewal is on demand and deduplicated: Hayat rotates refresh tokens and
 * revokes the whole family if one is presented twice, so two concurrent
 * refreshes would sign the person out.
 */
type Status = 'loading' | 'signedIn' | 'signedOut' | 'unconfigured'

type Auth = {
  status: Status
  user: AuthUser | null
  config: AuthConfig | null
  // Hayat's account page: name, password, time zone, sign-in methods.
  accountUrl: string | null
  signIn: (returnTo?: string) => Promise<void>
  // Back from Hayat: finish the code exchange; resolves to where to go next.
  completeSignIn: () => Promise<string>
  logout: () => Promise<void>
}

const AuthContext = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [accountUrl, setAccountUrl] = useState<string | null>(null)
  const refreshing = useRef<Promise<User | null> | null>(null)
  const redirecting = useRef(false)

  // During render on purpose: an effect would run after the children have
  // already formatted their times in the previous zone.
  setDisplayTimeZone(user?.timezone)

  const manager = useMemo(
    () =>
      config?.issuer && config.clientId
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

  // A valid access token, renewed first when it is about to lapse.
  const accessToken = useCallback(async () => {
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
  }, [manager])

  useEffect(() => {
    setTokenSource(accessToken)
  }, [accessToken])

  const signIn = useCallback(
    async (returnTo?: string) => {
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

  // 1. Where to sign in.
  useEffect(() => {
    getAuthConfig()
      .then((c) => {
        setConfig(c)
        if (!c.issuer || !c.clientId) setStatus('unconfigured')
      })
      .catch(() => setStatus('unconfigured'))
  }, [])

  // 2. Already holding a token in this tab? Ask who it belongs to.
  useEffect(() => {
    if (!manager || window.location.pathname === '/callback') return
    void (async () => {
      if (await accessToken()) await loadMe()
      else setStatus('signedOut')
    })()
  }, [manager, accessToken, loadMe])

  // A call came back 401 with a token: it was revoked or the account changed.
  // Drop it and go back through Hayat, which signs straight back in if its own
  // session is still good.
  useEffect(() => {
    const onUnauthorized = () => {
      if (!manager) return
      void manager.removeUser().then(() => signIn())
    }
    window.addEventListener('auth:unauthorized', onUnauthorized)
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized)
  }, [manager, signIn])

  const completeSignIn = useCallback(async () => {
    if (!manager) throw new Error('Sign-in is not configured')
    const u = await manager.signinRedirectCallback()
    await loadMe()
    const returnTo = (u.state as { returnTo?: string } | undefined)?.returnTo
    return returnTo && returnTo.startsWith('/') && !returnTo.startsWith('/callback') ? returnTo : '/'
  }, [manager, loadMe])

  const logout = useCallback(async () => {
    if (!manager) return
    const u = await manager.getUser()
    redirecting.current = true
    await manager.removeUser()
    await manager.signoutRedirect({ id_token_hint: u?.id_token })
  }, [manager])

  const value = useMemo(
    () => ({ status, user, config, accountUrl, signIn, completeSignIn, logout }),
    [status, user, config, accountUrl, signIn, completeSignIn, logout],
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
