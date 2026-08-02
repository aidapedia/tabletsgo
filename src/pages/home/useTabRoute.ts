import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Binds a page's tab bar to a path segment (`/workspace/member`).
 *
 * Whatever is on screen must have an address that reproduces it, so landing on
 * the bare section path rewrites the URL to the first tab instead of showing an
 * untitled default. The same rewrite catches a segment that isn't a tab here —
 * a stale link, or a tab this caller's role doesn't get (Settings hides Data
 * and Keymap from an instance admin) — rather than rendering nothing.
 *
 * Returns the tab to render and the handler that navigates between tabs.
 */
export default function useTabRoute(base: string, tabs: { id: string }[], sub?: string) {
  const navigate = useNavigate()
  const known = tabs.some((t) => t.id === sub)
  const active = known ? (sub as string) : tabs[0]?.id || ''

  useEffect(() => {
    if (!known && active) navigate(`${base}/${active}`, { replace: true })
  }, [known, active, base, navigate])

  return { active, onTab: (id: string) => navigate(`${base}/${id}`) }
}
