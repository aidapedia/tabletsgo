import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/features/auth'
import { listMembers, type Member } from '@/features/workspaces/api'
import { safeRequest } from '@/shared/api/request'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import Select from '@/shared/ui/form/Select'
import { controlClass } from '@/shared/ui/form/Input'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { useToast } from '@/shared/ui/feedback/Toast'
import PersonRow from '@/shared/ui/PersonRow'
import { PlusIcon, TrashIcon, UsersIcon } from '@/shared/ui/icons'
import { addNodeMember, removeNodeMember } from '../api'
import type { NodeMember, ResourceNode } from '../types'

/**
 * Who is inside this group.
 *
 * Separate from the grant list directly above it, and gated on a different
 * permission (`teams.manage`, not `resources.organise`), because the two do
 * different things: a grant here says what its holder may do *at this node*,
 * while the roster decides who every grant made *to* this group reaches — often
 * somewhere else entirely, where none of it shows on that node's grant list.
 *
 * Membership is flat by design: a group holds people, never other groups, so
 * nesting a group under another organises resources and says nothing about who
 * belongs to it. Re-filing a folder must never hand anyone access.
 *
 * A workspace node uses this too — it is a group like any other, and its roster
 * *is* its membership (one roster table since meta migration v16). There the
 * governing permission is `members.manage` rather than `teams.manage`, which the
 * server decides; being on it is what makes the workspace's resources visible.
 */
export default function NodeMembers({
  node,
  members,
  canManage,
  onChanged,
}: {
  node: ResourceNode
  members: NodeMember[]
  canManage: boolean
  onChanged: () => void
}) {
  const toast = useToast()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [adding, setAdding] = useState(false)
  const [candidates, setCandidates] = useState<Member[] | null>(null)
  const [picked, setPicked] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState<NodeMember | null>(null)
  // A workspace's roster *is* its membership: these people are the workspace, and
  // being on it is what makes every resource inside it visible to them.
  const isWorkspace = node.type === 'workspace'
  // Joining a workspace is an invitation, not a roster edit — it needs an email,
  // an invite token and the last-owner rule. That flow already exists on the
  // workspace's Members page, so this panel shows the membership and sends you
  // there rather than half-reimplementing it. (The API still accepts roster
  // writes on a workspace node; it enforces the same rules.)
  const canEdit = canManage && !isWorkspace

  // An instance admin holds no membership, so the member-scoped route 403s for
  // them — they read the workspace's people through the admin route instead.
  useEffect(() => {
    if (!adding || !node.workspaceId) return
    const wsId = node.workspaceId
    let alive = true
    const load = isAdmin
      ? safeRequest<Member[]>(`/admin/workspaces/${wsId}/members`, [])
      : listMembers(wsId).catch(() => [] as Member[])
    load.then((m) => alive && setCandidates(m))
    return () => {
      alive = false
    }
  }, [adding, node.workspaceId, isAdmin])

  // Only people who aren't in it yet — the server ignores a duplicate, but
  // offering one is a dead option.
  const options = useMemo(() => {
    const already = new Set(members.map((m) => m.userId))
    return (candidates || [])
      .filter((c) => !already.has(c.userId))
      .map((c) => ({ value: c.userId, label: c.name || c.email }))
  }, [candidates, members])

  const submit = async () => {
    if (!picked) return
    setSaving(true)
    try {
      await addNodeMember(node.id, picked)
      toast.success(isWorkspace ? 'Added to the workspace.' : 'Added to the group.')
      setAdding(false)
      setPicked('')
      onChanged()
    } catch (error: any) {
      toast.error(error?.message || 'Could not add them to the group.')
    } finally {
      setSaving(false)
    }
  }

  const submitRemove = async (member: NodeMember) => {
    try {
      await removeNodeMember(node.id, member.userId)
      toast.success(isWorkspace ? 'Removed from the workspace.' : 'Removed from the group.')
      setConfirm(null)
      onChanged()
    } catch (error: any) {
      toast.error(error?.message || 'Could not remove them.')
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <UsersIcon width={12} height={12} className="text-ink-faint" />
        <h3 className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">
          {isWorkspace ? 'Members of this workspace' : 'Members of this group'}
          {members.length > 0 && <span className="ml-1 font-normal normal-case tracking-normal">({members.length})</span>}
        </h3>
        {canEdit && !adding && (
          <IconButton size="sm" className="ml-auto" onClick={() => setAdding(true)} aria-label="Add someone to this group">
            <PlusIcon width={13} height={13} />
          </IconButton>
        )}
      </div>

      {adding && (
        <div className="mb-2 flex flex-col gap-2 rounded-[7px] border border-edge p-2.5">
          {candidates === null ? (
            <LoadingState className="py-2 text-center" />
          ) : (
            <>
              <Select
                value={picked}
                onChange={setPicked}
                placeholder="Who…"
                options={options}
                className={controlClass}
                disabled={!options.length}
              />
              {!options.length && (
                <p className="text-[10px] leading-relaxed text-ink-faint">
                  {isWorkspace
                    ? 'Everyone on the instance already belongs to this workspace.'
                    : 'Everyone in this workspace is already in this group.'}
                </p>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={submit} disabled={!picked || saving}>
                  {saving ? 'Adding…' : 'Add'}
                </Button>
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => {
                    setAdding(false)
                    setPicked('')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Said out loud because this list sits under the access list and would
          otherwise read as a second one: a roster is not access *here*. */}
      <p className="mb-2 text-[10px] leading-relaxed text-ink-faint">
        {isWorkspace
          ? "These people are the workspace — being here is what makes everything inside it visible to them. Invite and remove them from the workspace's Members settings."
          : 'Being in this group is not access to it — these people get whatever the group was granted, wherever that grant was made.'}
      </p>

      {members.length === 0 ? (
        <EmptyState className="py-4">
          {isWorkspace
            ? 'Nobody yet — members of this workspace see everything in it.'
            : 'Nobody yet — a grant made to this group reaches whoever is in it.'}
        </EmptyState>
      ) : (
        <div className="flex flex-col divide-y divide-edge overflow-hidden rounded-soft border border-edge">
          {members.map((m) => (
            <div key={m.userId} className="flex items-center gap-2.5 bg-elevated/30 px-3 py-2">
              <PersonRow size="md" name={m.name} email={m.email} />
              {canEdit && (
                <IconButton
                  size="sm"
                  className="ml-auto hover:!text-red"
                  onClick={() => setConfirm(m)}
                  aria-label={`Remove ${m.name || m.email}`}
                >
                  <TrashIcon width={13} height={13} />
                </IconButton>
              )}
            </div>
          ))}
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title="Remove from group"
          message={
            isWorkspace
              ? `Remove ${confirm.name || confirm.email} from "${node.name}"? They lose access to everything in the workspace, including any group seats and anything they were granted inside it.`
              : `Remove ${confirm.name || confirm.email} from "${node.name}"? They lose everything this group is granted, wherever it is granted.`
          }
          confirmLabel="Remove"
          danger
          onConfirm={() => submitRemove(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
