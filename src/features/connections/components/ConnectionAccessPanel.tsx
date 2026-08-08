import { useEffect, useState } from 'react'
import { useToast } from '@/shared/ui/feedback/Toast'
import CheckboxRow from '@/shared/ui/form/CheckboxRow'
import Button from '@/shared/ui/buttons/Button'
import { EditIcon } from '@/shared/ui/icons'
import Avatar from '@/shared/ui/Avatar'
import Badge from '@/shared/ui/Badge'
import PersonRow from '@/shared/ui/PersonRow'
import { useWorkspaces, can, listMembers, type Member } from '@/features/workspaces'
import { fetchResourceTree, type ResourceNode } from '@/features/resource-tree'
import { useAuth } from '@/features/auth'
import Select from '@/shared/ui/form/Select'
import { controlClass } from '@/shared/ui/form/Input'
import { getConnectionAccess, setConnectionAccess, transferConnection } from '../api'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { toggleId } from '@/shared/lib/toggleId'

// Access management for a single connection, shown as the detail's "Access" tab:
// who owns it, who can open it, and an inline editor for both.
export default function ConnectionAccessPanel({ conn, onChange }: { conn: any; onChange?: () => void }) {
  const toast = useToast()
  const { current } = useWorkspaces()
  const { user } = useAuth()
  const workspaceId = current?.id
  // Editing the access list follows the same rule the server applies: manage
  // every connection here, or own this one. Handing it to someone else is a
  // separate permission — it can take the connection away from you.
  const canEditAccess = can(current, 'connections.manage') || (!!user && conn.ownerId === user.id)
  const canTransfer = can(current, 'connections.transfer')

  const [groups, setGroups] = useState<ResourceNode[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [groupIds, setGroupIds] = useState<string[]>([])
  const [userIds, setUserIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  // Draft copy used while editing so Cancel can revert.
  const [draftGroups, setDraftGroups] = useState<string[]>([])
  const [draftUsers, setDraftUsers] = useState<string[]>([])
  const [transferring, setTransferring] = useState(false)

  const load = () => {
    if (!workspaceId) return
    setLoading(true)
    Promise.all([fetchResourceTree(), listMembers(workspaceId), getConnectionAccess(conn.id)]).then(([t, m, access]) => {
      setGroups(
          t.filter(
            (n) =>
              n.workspaceId === workspaceId &&
              !n.context &&
              // The workspace's own node is a principal too: it names exactly
              // "everyone in this workspace", which is what an access list used
              // to mean when it was empty. Leaving it out of the options would
              // render an existing row as nothing and drop it on the next save.
              (n.type === 'group' || n.type === 'workspace')
          )
        )
      setMembers(m)
      setGroupIds(access.groups)
      setUserIds(access.users)
      setLoading(false)
    })
  }
  useEffect(load, [workspaceId, conn.id])

  const startEdit = () => {
    setDraftGroups(groupIds)
    setDraftUsers(userIds)
    setEditing(true)
  }
  const toggleGroup = (id: string) => setDraftGroups((p) => toggleId(p, id))
  const toggleUser = (id: string) => setDraftUsers((p) => toggleId(p, id))

  const save = async () => {
    setSaving(true)
    try {
      await setConnectionAccess(conn.id, { groups: draftGroups, users: draftUsers })
      setGroupIds(draftGroups)
      setUserIds(draftUsers)
      setEditing(false)
      toast.success('Access updated.')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const transfer = async (ownerId: string) => {
    setTransferring(true)
    try {
      await transferConnection(conn.id, ownerId)
      toast.success(`${members.find((m) => m.userId === ownerId)?.name || 'They'} now own this connection.`)
      onChange?.()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setTransferring(false)
    }
  }

  if (loading) return <LoadingState className="py-10 text-center" />

  const open = groupIds.length === 0 && userIds.length === 0
  const assignedGroups = groups.filter((g) => groupIds.includes(g.id))
  // The workspace node stands for its whole membership, so say that rather than
  // showing the workspace's name as if it were a group someone joined.
  const label = (n: ResourceNode) => (n.type === 'workspace' ? `Everyone in ${n.name}` : n.name)
  // Whoever manages every connection already sees this one, so listing them as
  // grantable individuals would be noise.
  const selectableMembers = members.filter((m) => !m.permissions?.includes('connections.manage'))
  const assignedMembers = selectableMembers.filter((m) => userIds.includes(m.userId))
  const ownerName = conn.ownerName || conn.ownerEmail
  const ownerId = conn.ownerId

  return (
    <div className="flex flex-col gap-5">
      {/* Owner */}
      <div className="rounded-card border border-edge bg-card p-5">
        <div className="mb-3 text-[13px] font-bold">Owner</div>
        {ownerName ? (
          <div className="flex items-center gap-2.5">
            <Avatar label={ownerName} />
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium text-ink">{ownerName}</div>
              {conn.ownerEmail && <div className="truncate text-[11px] text-ink-faint">{conn.ownerEmail}</div>}
            </div>
            <Badge tone="green" className="ml-auto shrink-0">Owner</Badge>
          </div>
        ) : (
          <p className="text-[12px] text-ink-faint">No owner recorded.</p>
        )}
        {canTransfer && (
          <div className="mt-4 border-t border-edge pt-4">
            <div className="mb-2 text-[11px] font-medium text-ink-dim">Transfer ownership</div>
            <Select
              className={`${controlClass} !w-[240px]`}
              value={ownerId || ''}
              disabled={transferring}
              options={[
                { value: '', label: 'Choose a member…' },
                ...members.map((m) => ({ value: m.userId, label: m.name || m.email })),
              ]}
              onChange={(id) => id && id !== ownerId && transfer(id)}
            />
            <p className="mt-1.5 text-[10px] text-ink-faint">
              The new owner can edit, back up and delete this connection. You keep that only if your role does.
            </p>
          </div>
        )}
      </div>

      {/* Who can access */}
      <div className="rounded-card border border-edge bg-card p-5">
        <div className="mb-1 flex items-center justify-between gap-3">
          <div className="text-[13px] font-bold">Who can access</div>
          {canEditAccess && !editing && (
            <Button variant="subtle" size="sm" icon={EditIcon} onClick={startEdit}>
              Edit access
            </Button>
          )}
        </div>

        {!editing ? (
          <div className="mt-3">
            {open ? (
              <p className="text-[12px] text-ink-dim">Open to everyone in the workspace.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {assignedGroups.length > 0 && (
                  <div>
                    <div className="mb-2 text-[11px] font-medium text-ink-dim">Groups</div>
                    <div className="flex flex-wrap gap-2">
                      {assignedGroups.map((t) => (
                        <span key={t.id} className="inline-flex items-center gap-1.5 rounded-[8px] border border-edge bg-elevated px-2.5 py-1 text-[11px] text-ink-dim">
                          {label(t)}
                          <span className="rounded bg-edge px-1 py-0.5 text-[9px] text-ink-faint">{t.memberCount ?? 0}</span>
                        </span>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[10px] text-ink-faint">Everyone in these groups can access this connection.</p>
                  </div>
                )}
                {assignedMembers.length > 0 && (
                  <div>
                    <div className="mb-2 text-[11px] font-medium text-ink-dim">Individual members</div>
                    <div className="flex flex-col divide-y divide-edge overflow-hidden rounded-soft border border-edge">
                      {assignedMembers.map((m) => (
                        <div key={m.userId} className="flex items-center gap-2.5 bg-elevated/30 px-3 py-2">
                          <PersonRow size="md" name={m.name} email={m.email} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-ink-faint">Whoever manages every connection always has access.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {groups.length > 0 && (
              <div>
                <div className="mb-2 text-[11px] font-medium text-ink-dim">Groups</div>
                <div className="flex flex-col gap-2">
                  {groups.map((t) => (
                    <CheckboxRow key={t.id} checked={draftGroups.includes(t.id)} onChange={() => toggleGroup(t.id)} ariaLabel={label(t)}>
                      <span className="min-w-0 flex-1 truncate text-[12px]">{label(t)}</span>
                      <span className="shrink-0 text-[10px] text-ink-faint">{t.memberCount ?? 0} member{(t.memberCount ?? 0) === 1 ? '' : 's'}</span>
                    </CheckboxRow>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="mb-2 text-[11px] font-medium text-ink-dim">Individual members</div>
              {selectableMembers.length === 0 ? (
                <p className="text-[12px] text-ink-faint">No other members yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {selectableMembers.map((m) => (
                    <CheckboxRow key={m.userId} checked={draftUsers.includes(m.userId)} onChange={() => toggleUser(m.userId)} ariaLabel={m.email}>
                      <PersonRow
                        size="md"
                        name={m.name}
                        email={m.email}
                        suffix={m.userId === ownerId && <span className="ml-1.5 text-[10px] text-ink-faint">(owner)</span>}
                      />
                    </CheckboxRow>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[10px] text-ink-faint">
              Leave everything unchecked to keep this connection open to all workspace members. Whoever manages every connection always has access.
            </p>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save access'}
              </Button>
              <Button variant="subtle" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
