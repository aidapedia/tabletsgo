import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/features/auth'
import { listMembers, type Member } from '@/features/workspaces/api'
import { safeRequest } from '@/shared/api/request'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import SearchInput from '@/shared/ui/form/SearchInput'
import PersonRow from '@/shared/ui/PersonRow'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { setNodeOwner } from '../api'
import { TYPE_LABEL } from '../lib/tree'
import type { ResourceNode } from '../types'

/**
 * Hand a node to someone else.
 *
 * Ownership cascades: the owner may do everything at this node and below it. So
 * the people offered are the node's workspace members, the only people the
 * server accepts. Who may open this dialog is decided on the server too: the
 * node's owner (or an ancestor's), an owner of the workspace, or an instance
 * admin.
 *
 * The current owner is left out of the list, since handing a node to the person
 * who already holds it changes nothing.
 */
export default function TransferOwnerDialog({
  node,
  currentOwnerId,
  onClose,
  onChanged,
}: {
  node: ResourceNode
  currentOwnerId: string | null
  onClose: () => void
  onChanged: () => void
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [members, setMembers] = useState<Member[] | null>(null)
  const [query, setQuery] = useState('')
  const [targetId, setTargetId] = useState('')
  const [busy, setBusy] = useState(false)

  // An instance admin holds no membership, so the member route refuses them and
  // they read the roster through the admin route instead, as GrantForm does.
  useEffect(() => {
    if (!node.workspaceId) return setMembers([])
    const wsId = node.workspaceId
    let alive = true
    const load = isAdmin ? safeRequest<Member[]>(`/admin/workspaces/${wsId}/members`, []) : listMembers(wsId)
    load.then((m) => alive && setMembers(m)).catch(() => alive && setMembers([]))
    return () => {
      alive = false
    }
  }, [node.workspaceId, isAdmin])

  const candidates = useMemo(() => (members || []).filter((m) => m.userId !== currentOwnerId), [members, currentOwnerId])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? candidates.filter((m) => `${m.name} ${m.email}`.toLowerCase().includes(q)) : candidates
  }, [candidates, query])

  const submit = async () => {
    if (!targetId) return
    setBusy(true)
    try {
      await setNodeOwner(node.id, targetId)
      toast.success('Ownership transferred.')
      onClose()
      onChanged()
    } catch (error: any) {
      toast.error(error?.message || 'Could not transfer ownership.')
    } finally {
      setBusy(false)
    }
  }

  const label = TYPE_LABEL[node.type].toLowerCase()

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100vh-6rem)] flex-col sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{`Transfer "${node.name}"`}</DialogTitle>
        </DialogHeader>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <div className="flex flex-col gap-3">
            <p className="text-[11px] leading-relaxed text-faint">
              The new owner can do everything on this {label} and everything inside it. Only members of its workspace can own it.
            </p>

            {members === null ? (
              <LoadingState className="py-8 text-center" />
            ) : (
              <>
                {candidates.length > 0 && (
                  <SearchInput
                    autoFocus
                    value={query}
                    placeholder="Search members"
                    onChange={(e) => setQuery(e.target.value)}
                    inputClassName="h-8 text-[12px]"
                  />
                )}
                <div className="flex max-h-[320px] flex-col gap-0.5 overflow-y-auto">
                  {shown.length === 0 ? (
                    <EmptyState className="py-8">
                      {candidates.length === 0 ? 'Nobody else in this workspace can take it over.' : 'No member matches that.'}
                    </EmptyState>
                  ) : (
                    shown.map((m) => (
                      <button
                        key={m.userId}
                        type="button"
                        onClick={() => setTargetId(m.userId)}
                        className={`flex items-center gap-2 rounded-[7px] border px-2.5 py-2 text-left transition-colors ${
                          m.userId === targetId
                            ? 'border-primary/40 bg-primary/10 text-foreground'
                            : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        <PersonRow name={m.name} email={m.email} />
                      </button>
                    ))
                  )}
                </div>
              </>
            )}

            <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button variant="default" onClick={submit} disabled={!targetId || busy}>
                {busy ? 'Transferring…' : 'Transfer'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
