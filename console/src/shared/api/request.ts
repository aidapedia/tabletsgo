import { API_URL } from '@/shared/config'

// Where the access token comes from. The auth store (features/auth) registers
// one: it hands out the Hayat access token, renewing it first when it is about
// to lapse, so every backend call is authenticated without callers threading
// the token through.
type TokenSource = () => Promise<string | null>
let tokenSource: TokenSource = async () => null
export const setTokenSource = (fn: TokenSource) => {
  tokenSource = fn
}
export const getToken = () => tokenSource().catch(() => null)

type RequestOptions = {
  method?: string
  body?: unknown
  signal?: AbortSignal
  // false: send no token. For the calls that get one (solo sign-in and refresh),
  // which would otherwise ask the token source — and so themselves — for one.
  auth?: boolean
}

/**
 * The single place that talks to the backend. Prefixes {@link API_URL}, sets
 * JSON headers only when there's a body, parses the response, and throws an
 * Error carrying the server's `error` message on any non-2xx status.
 *
 * Use for mutations (callers `try/catch` and surface the message). For reads
 * that should degrade to a default instead, use {@link safeRequest}.
 */
export async function request<T = any>(path: string, { method = 'GET', body, signal, auth = true }: RequestOptions = {}): Promise<T> {
  const token = auth ? await getToken() : null
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_URL}${path}`, {
    method,
    signal,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // A 401 on a call that carried a session token means that token is
    // expired/invalid — tell the auth store to sign out and bounce to login.
    if (res.status === 401 && token) window.dispatchEvent(new Event('auth:unauthorized'))
    // `status` and `data` ride along for the callers that act on more than the
    // message (a 409 that lists what blocked it).
    throw Object.assign(new Error((data as any)?.error || `${method} ${path} failed (${res.status})`), { status: res.status, data })
  }
  return data as T
}

/** Like {@link request} but returns `fallback` (and logs) instead of throwing. */
export async function safeRequest<T>(path: string, fallback: T, opts?: RequestOptions): Promise<T> {
  try {
    return await request<T>(path, opts)
  } catch (error) {
    console.error(`API ${path}:`, error)
    return fallback
  }
}
