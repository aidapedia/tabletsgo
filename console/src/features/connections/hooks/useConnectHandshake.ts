import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { handshakeConnection } from '@/shared/api/database'
import type { Handshake } from '@/shared/api/database'

export type HandshakeFailure = { conn: any; result: Handshake }

/**
 * "Connect" that knocks before it opens the door: probe the connection, and
 * only route into the console once the database actually answered. A failed
 * probe surfaces a root cause (render {@link ConnectHandshakeDialog} with
 * `failure`) instead of dropping the user into a console where every panel
 * fails on its own.
 *
 * `connectingId` is the connection being probed, so a list can put just that
 * row's button into a pending state.
 */
export function useConnectHandshake() {
  const navigate = useNavigate()
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [failure, setFailure] = useState<HandshakeFailure | null>(null)
  const inFlight = useRef(false)

  const open = useCallback((conn: any) => navigate(`/connection/${conn.id}`), [navigate])

  const connect = useCallback(
    async (conn: any) => {
      if (!conn || inFlight.current) return
      inFlight.current = true
      setFailure(null)
      setConnectingId(conn.id)
      try {
        const result = await handshakeConnection(conn)
        if (result.ok) open(conn)
        else setFailure({ conn, result })
      } finally {
        inFlight.current = false
        setConnectingId(null)
      }
    },
    [open]
  )

  return {
    connect,
    connectingId,
    failure,
    dismiss: useCallback(() => setFailure(null), []),
    // Escape hatch from the failure dialog: the probe can be wrong (a server
    // that was briefly restarting), so let the user through when they insist.
    openAnyway: useCallback(
      (conn: any) => {
        setFailure(null)
        open(conn)
      },
      [open]
    ),
  }
}
