import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ExternalLink } from 'lucide-react'
import PersonAvatar from '@/shared/ui/PersonAvatar'
import PersonRow from '@/shared/ui/PersonRow'
import { useWorkspaces, can, listMembers, type Member } from '@/features/workspaces'
import { useIdentity } from '@/features/auth'
import { getConnectionAccess, transferConnection, type ConnectionAccess } from '../api'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import OptionSelect from '@/shared/ui/form/OptionSelect'

/**
 * A connection's "Access" tab: who owns it, and who can open it.
 *
 * Opening a connection is granted in Hayat — on the connection, on a group it is
 * filed under, or by placing it in a group whose roster should use it. This tab
 * shows Hayat's resolved answer, every way in with the reason, and links to the
 * connection's node in Hayat's console to change it. Ownership is still handed
 * over here, because it is a field of the connection itself.
 */
export default function ConnectionAccessPanel({ conn, onChange }: { conn: any; onChange?: () => void }) {
  // Solo: nobody else exists, so there is nothing to show or hand over.
  const { people } = useIdentity()
  if (!people) {
    return (
      <p className="max-w-[560px] text-[13px] text-muted-foreground">
        Only you. This instance runs in solo mode, so nobody else can open this connection. Switch to enterprise mode to share connections with a team.
      </p>
    )
  }
  return <AccessPanel conn={conn} onChange={onChange} />
}

function AccessPanel({ conn, onChange }: { conn: any; onChange?: () => void }) {
  const { current } = useWorkspaces()
  const workspaceId = current?.id
  const canTransfer = can(current, 'connections.transfer')

  const [access, setAccess] = useState<ConnectionAccess | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [transferring, setTransferring] = useState(false)

  const load = () => {
    if (!workspaceId) return
    Promise.all([getConnectionAccess(conn.id), listMembers(workspaceId)]).then(([a, m]) => {
      setAccess(a)
      setMembers(m)
    })
  }
  useEffect(load, [workspaceId, conn.id])

  const transfer = async (ownerId: string) => {
    setTransferring(true)
    try {
      await transferConnection(conn.id, ownerId)
      toast.success(`${members.find((m) => m.userId === ownerId)?.name || 'They'} now own this connection.`)
      onChange?.()
      load()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setTransferring(false)
    }
  }

  if (!access) return <LoadingState className="py-10 text-center" />

  const ownerName = conn.ownerName || conn.ownerEmail
  const ownerId = conn.ownerId

  return (
    <div className="flex flex-col gap-5">
      {/* Owner */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 text-[13px] font-bold">Owner</div>
        {ownerName ? (
          <div className="flex items-center gap-2.5">
            <PersonAvatar seed={ownerName} />
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium text-foreground">{ownerName}</div>
              {conn.ownerEmail && <div className="truncate text-[11px] text-faint">{conn.ownerEmail}</div>}
            </div>
            <Badge variant="default" className="ml-auto shrink-0">Owner</Badge>
          </div>
        ) : (
          <p className="text-[12px] text-faint">No owner recorded.</p>
        )}
        {canTransfer && (
          <div className="mt-4 border-t border-border pt-4">
            <div className="mb-2 text-[11px] font-medium text-muted-foreground">Transfer ownership</div>
            <OptionSelect
              className="!w-[240px]"
              value={ownerId || ''}
              disabled={transferring}
              options={[{ value: '', label: 'Choose a member…' }, ...members.map((m) => ({ value: m.userId, label: m.name || m.email }))]}
              onChange={(id) => id && id !== ownerId && transfer(id)}
            />
            <p className="mt-1.5 text-[10px] text-faint">The new owner can edit, back up and delete this connection, and open it.</p>
          </div>
        )}
      </div>

      {/* Who can open it */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-1 flex items-center justify-between gap-3">
          <div className="text-[13px] font-bold">Who can open it</div>
          {access.manageUrl && (
            <Button asChild variant="ghost" size="sm">
              <a href={access.manageUrl} target="_blank" rel="noreferrer">
                Manage in Hayat <ExternalLink />
              </a>
            </Button>
          )}
        </div>
        {access.people.length === 0 ? (
          <p className="mt-3 text-[12px] text-muted-foreground">
            Nobody yet. Grant the Connection user role on it in Hayat, or file it under a group whose members should use it.
          </p>
        ) : (
          <div className="mt-3 flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
            {access.people.map((p) => (
              <div key={p.userId} className="flex items-center gap-2.5 bg-muted/30 px-3 py-2">
                <PersonRow size="md" name={p.name || p.email || p.userId} email={p.email || ''} />
                {p.reason && <span className="ml-auto truncate pl-3 text-[11px] text-faint">{p.reason}</span>}
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-[10px] text-faint">
          Access comes from Hayat: a grant on this connection or a group above it, the roster of a group it is filed under, or owning it. Only members of the workspace can ever open it.
        </p>
      </div>
    </div>
  )
}
