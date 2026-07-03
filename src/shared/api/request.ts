import { API_URL } from '@/shared/config'

// Session token key — written by the auth store, read here so every backend
// call is authenticated without callers threading the token through.
export const TOKEN_KEY = 'dbm.token'
export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

type RequestOptions = {
  method?: string
  body?: unknown
  signal?: AbortSignal
}

/**
 * The single place that talks to the backend. Prefixes {@link API_URL}, sets
 * JSON headers only when there's a body, parses the response, and throws an
 * Error carrying the server's `error` message on any non-2xx status.
 *
 * Use for mutations (callers `try/catch` and surface the message). For reads
 * that should degrade to a default instead, use {@link safeRequest}.
 */
export async function request<T = any>(path: string, { method = 'GET', body, signal }: RequestOptions = {}): Promise<T> {
  const token = getToken()
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
  if (!res.ok) throw new Error((data as any)?.error || `${method} ${path} failed (${res.status})`)
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
