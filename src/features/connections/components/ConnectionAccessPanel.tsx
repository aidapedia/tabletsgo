import { useEffect, useState } from 'react'
import { useToast } from '@/shared/ui/feedback/Toast'
import CheckboxRow from '@/shared/ui/form/CheckboxRow'
import Button from '@/shared/ui/buttons/Button'
import { EditIcon } from '@/shared/ui/icons'
import Avatar from '@/shared/ui/Avatar'
import Badge from '@/shared/ui/Badge'
import PersonRow from '@/shared/ui/PersonRow'
import { useWorkspaces, listTeams, listMembers, type Team, type Member } from '@/features/workspaces'
import { getConnectionAccess, setConnectionAccess } from '../api'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { toggleId } from '@/shared/lib/toggleId'

// Access management for a single connection, shown as the detail's "Access" tab.
// Read-only overview (owner + who can access) with an admin-only inline editor.
export default function ConnectionAccessPanel({ conn }: { conn: any }) {
  const toast = useToast()
  const { current } = useWorkspaces()
  const workspaceId = current?.id
  const isAdmin = current?.role === 'admin'

  const [teams, setTeams] = useState<Team[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [teamIds, setTeamIds] = useState<string[]>([])
  const [userIds, setUserIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  // Draft copy used while editing so Cancel can revert.
  const [draftTeams, setDraftTeams] = useState<string[]>([])
  const [draftUsers, setDraftUsers] = useState<string[]>([])

  const load = () => {
    if (!workspaceId) return
    setLoading(true)
    Promise.all([listTeams(workspaceId), listMembers(workspaceId), getConnectionAccess(conn.id)]).then(([t, m, access]) => {
      setTeams(t)
      setMembers(m)
      setTeamIds(access.teams)
      setUserIds(access.users)
      setLoading(false)
    })
  }
  useEffect(load, [workspaceId, conn.id])

  const startEdit = () => {
    setDraftTeams(teamIds)
    setDraftUsers(userIds)
    setEditing(true)
  }
  const toggleTeam = (id: string) => setDraftTeams((p) => toggleId(p, id))
  const toggleUser = (id: string) => setDraftUsers((p) => toggleId(p, id))

  const save = async () => {
    setSaving(true)
    try {
      await setConnectionAccess(conn.id, { teams: draftTeams, users: draftUsers })
      setTeamIds(draftTeams)
      setUserIds(draftUsers)
      setEditing(false)
      toast.success('Access updated.')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingState className="py-10 text-center" />

  const open = teamIds.length === 0 && userIds.length === 0
  const assignedTeams = teams.filter((t) => teamIds.includes(t.id))
  // Admins already have access to every connection, so there's no point listing
  // them as grantable individuals.
  const selectableMembers = members.filter((m) => m.role !== 'admin')
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
      </div>

      {/* Who can access */}
      <div className="rounded-card border border-edge bg-card p-5">
        <div className="mb-1 flex items-center justify-between gap-3">
          <div className="text-[13px] font-bold">Who can access</div>
          {isAdmin && !editing && (
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
                {assignedTeams.length > 0 && (
                  <div>
                    <div className="mb-2 text-[11px] font-medium text-ink-dim">Teams</div>
                    <div className="flex flex-wrap gap-2">
                      {assignedTeams.map((t) => (
                        <span key={t.id} className="inline-flex items-center gap-1.5 rounded-[8px] border border-edge bg-elevated px-2.5 py-1 text-[11px] text-ink-dim">
                          {t.name}
                          <span className="rounded bg-edge px-1 py-0.5 text-[9px] text-ink-faint">{t.memberCount}</span>
                        </span>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[10px] text-ink-faint">All members of these teams can access this connection.</p>
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
                <p className="text-[10px] text-ink-faint">Workspace admins always have access.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {teams.length > 0 && (
              <div>
                <div className="mb-2 text-[11px] font-medium text-ink-dim">Teams</div>
                <div className="flex flex-col gap-2">
                  {teams.map((t) => (
                    <CheckboxRow key={t.id} checked={draftTeams.includes(t.id)} onChange={() => toggleTeam(t.id)} ariaLabel={t.name}>
                      <span className="min-w-0 flex-1 truncate text-[12px]">{t.name}</span>
                      <span className="shrink-0 text-[10px] text-ink-faint">{t.memberCount} member{t.memberCount === 1 ? '' : 's'}</span>
                    </CheckboxRow>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="mb-2 text-[11px] font-medium text-ink-dim">Individual members</div>
              {selectableMembers.length === 0 ? (
                <p className="text-[12px] text-ink-faint">No non-admin members yet.</p>
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
              Leave everything unchecked to keep this connection open to all workspace members. Workspace admins always have access.
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
