import { API_URL } from '@/shared/config'

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
  const res = await fetch(`${API_URL}${path}`, {
    method,
    signal,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
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
