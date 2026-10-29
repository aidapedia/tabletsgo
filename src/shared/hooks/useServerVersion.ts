import { useEffect, useState } from 'react'
import { getServerVersion } from '@/shared/api/database'

// One lookup per connection for the page's lifetime — the status bar and every
// console tab ask, and a server's version doesn't change under an open console.
const cache = new Map<string, Promise<string | null>>()

/** The connected server's version ("16.4", "3.45.1", "7.4.8"), or null until known / when the engine can't say. */
export default function useServerVersion(conn: any): string | null {
  const id = conn?.id
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return setVersion(null)
    if (!cache.has(id)) {
      const lookup = getServerVersion(conn)
      cache.set(id, lookup)
      // A miss (server unreachable just now) isn't remembered, so the next mount asks again.
      lookup.then((v) => {
        if (!v) cache.delete(id)
      })
    }
    let live = true
    cache.get(id)!.then((v) => live && setVersion(v))
    return () => {
      live = false
    }
    // Keyed by id only: the version belongs to the server, not to the db picked in it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return version
}
