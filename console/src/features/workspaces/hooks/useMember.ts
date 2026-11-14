import { useEffect, useState } from 'react'
import { getMember, type MemberDetail } from '../api'

// One member of the workspace and their access. `member` is null once loading
// is done if they aren't on the roster (or the read failed).
export function useMember(workspaceId: string | undefined, userId: string | undefined) {
  const [member, setMember] = useState<MemberDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!workspaceId || !userId) return
    let alive = true
    setLoading(true)
    getMember(workspaceId, userId).then((m) => {
      if (!alive) return
      setMember(m)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [workspaceId, userId])

  return { member, loading }
}
