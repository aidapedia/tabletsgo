import { useEffect, useMemo, useState } from 'react'
import { getNamespaces, listObjects, pingConnection } from '@/shared/api/database'

/**
 * The live database behind the console: which namespace is selected, what
 * objects it holds, and whether it is still reachable.
 *
 * `nsConn` is the connection augmented with the selected database/schema — the
 * handle every data view is given, so switching namespace re-reads everything
 * without touching the stored connection.
 *
 * A dead database is a modal, not an empty sidebar: `loadTables` pings first,
 * and a heartbeat keeps checking while connected so a connection that drops
 * mid-session is caught too. `onReady` fires after a successful load, which is
 * where the console decides whether to open its first tab.
 */
export default function useConnectionBrowser(conn: any, { onReady }: { onReady?: () => void } = {}) {
  // Selected database/schema namespace (for browsing other DBs/schemas).
  const [ns, setNs] = useState<any>({ database: undefined, schema: undefined })
  const [namespaces, setNamespaces] = useState<any>({ databases: [], schemas: [] })
  const [objects, setObjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [connError, setConnError] = useState<string | null>(null) // set when the DB is unreachable
  const [reconnecting, setReconnecting] = useState(false) // retry in progress

  // Connection augmented with the selected namespace; passed to data views.
  const nsConn = useMemo(() => (conn ? { ...conn, ns } : conn), [conn, ns])

  // Table names (a subset of the browsable objects) — used by the table-specific
  // actions (open, edit, empty, delete, browse) that don't apply to views/functions.
  const tables = useMemo(() => objects.filter((o) => o.type === 'table').map((o) => o.name), [objects])

  const loadTables = async () => {
    if (!conn) return
    setLoading(true)
    // Verify the database is reachable first; a dead connection prompts the modal.
    const health = await pingConnection(nsConn)
    if (!health.ok) {
      setConnError(health.error || 'Could not connect to the database.')
      setObjects([])
      setLoading(false)
      return
    }
    setConnError(null)
    const objs = await listObjects(nsConn)
    setObjects(objs || [])
    onReady?.()
    setLoading(false)
  }

  // Retry from the "connection lost" modal. loadTables re-pings and clears the
  // error on success (closing the modal) or refreshes the message on failure.
  const reconnect = async () => {
    setReconnecting(true)
    await loadTables()
    setReconnecting(false)
  }

  // Heartbeat: while connected, poll so a connection that drops mid-session is
  // detected too (not just on open). Pauses once the modal is up.
  useEffect(() => {
    if (!conn || connError) return
    const iv = setInterval(async () => {
      const health = await pingConnection(nsConn)
      if (!health.ok) setConnError(health.error || 'The database connection was lost.')
    }, 15000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, nsConn, connError])

  // Reload the object list when the connection or selected namespace changes.
  useEffect(() => {
    loadTables()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, ns])

  // Load available databases/schemas and pick sensible defaults per connection.
  useEffect(() => {
    if (!conn) return
    let alive = true
    getNamespaces(conn).then((data) => {
      if (!alive) return
      setNamespaces(data)
      setNs({
        database: data.currentDatabase || conn.database || data.databases?.[0],
        schema: data.schemas?.includes('public') ? 'public' : data.schemas?.[0],
      })
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn])

  const changeDatabase = async (db: string) => {
    const data = await getNamespaces(conn, db)
    setNamespaces(data)
    setNs({ database: db, schema: data.schemas?.includes('public') ? 'public' : data.schemas?.[0] })
  }

  const changeSchema = (schema: string) => setNs((p: any) => ({ ...p, schema }))

  return {
    ns,
    namespaces,
    nsConn,
    objects,
    tables,
    loading,
    connError,
    reconnecting,
    loadTables,
    reconnect,
    changeDatabase,
    changeSchema,
  }
}
