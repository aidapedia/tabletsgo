import { useEffect, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import IconButton from '@/shared/ui/buttons/IconButton'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import { TrashIcon, ChevronDown, PlusSmall } from '@/shared/ui/icons'
import { Input } from '@/shared/ui/form/Input'
import SearchInput from '@/shared/ui/form/SearchInput'
import { Label } from '@/shared/ui/form/Form'
import PersonRow from '@/shared/ui/PersonRow'
import {
  listTeams, createTeam, renameTeam, deleteTeam,
  listTeamMembers, addTeamMember, removeTeamMember,
  listMembers, type Team, type TeamMember, type Member,
} from '@/features/workspaces/api'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import EmptyState from '@/shared/ui/feedback/EmptyState'

// Team management for a workspace: create/rename/delete teams and manage each
// team's members. `canManage` gates the admin-only controls.
export default function TeamsPanel({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const toast = useToast()
  const [teams, setTeams] = useState<Team[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Team | null>(null)

  const loadTeams = () => listTeams(workspaceId).then(setTeams)
  useEffect(() => {
    setLoading(true)
    Promise.all([listTeams(workspaceId), listMembers(workspaceId)]).then(([t, m]) => {
      setTeams(t)
      setMembers(m)
      setLoading(false)
    })
  }, [workspaceId])

  const submitCreate = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    try {
      await createTeam(workspaceId, name.trim())
      setName('')
      await loadTeams()
      toast.success('Team created.')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setCreating(false)
    }
  }

  const confirmRemove = async () => {
    const t = removing
    setRemoving(null)
    if (!t) return
    setTeams((prev) => prev.filter((x) => x.id !== t.id))
    try {
      await deleteTeam(workspaceId, t.id)
    } catch (err: any) {
      toast.error(err.message)
      loadTeams()
    }
  }

  return (
    <div>
      {canManage && (
        <form onSubmit={submitCreate} className="mb-5">
          <Label>Create a team</Label>
          <div className="flex gap-2">
            <Input placeholder="e.g. Backend" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" variant="primary" size="sm" disabled={creating}>
              {creating ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      )}

      <Label>Teams ({teams.length})</Label>
      {loading ? (
        <LoadingState />
      ) : teams.length === 0 ? (
        <EmptyState bordered>No teams yet.</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {teams.map((t) => (
            <TeamRow
              key={t.id}
              workspaceId={workspaceId}
              team={t}
              members={members}
              canManage={canManage}
              open={expanded === t.id}
              onToggle={() => setExpanded((cur) => (cur === t.id ? null : t.id))}
              onChanged={loadTeams}
              onRename={renameTeam}
              onRemove={() => setRemoving(t)}
            />
          ))}
        </div>
      )}

      {removing && (
        <ConfirmDialog
          title="Delete team?"
          message={`Delete "${removing.name}"? Its connection assignments will be removed too.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          danger
          onConfirm={confirmRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  )
}

// One team card: header (name, member count, expand) + expandable member manager.
function TeamRow({
  workspaceId, team, members, canManage, open, onToggle, onChanged, onRename, onRemove,
}: {
  workspaceId: string
  team: Team
  members: Member[]
  canManage: boolean
  open: boolean
  onToggle: () => void
  onChanged: () => void
  onRename: (workspaceId: string, teamId: string, name: string) => Promise<any>
  onRemove: () => void
}) {
  const toast = useToast()
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(team.name)

  const load = () => listTeamMembers(workspaceId, team.id).then((m) => { setTeamMembers(m); setLoaded(true) })
  useEffect(() => { if (open && !loaded) load() }, [open])

  const memberIds = new Set(teamMembers.map((m) => m.userId))
  const addable = members.filter((m) => !memberIds.has(m.userId))
  const q = query.trim().toLowerCase()
  const matches = q ? addable.filter((m) => (m.name || '').toLowerCase().includes(q) || m.email.toLowerCase().includes(q)) : addable

  const add = async (userId: string) => {
    try {
      await addTeamMember(workspaceId, team.id, userId)
      setQuery('')
      await load()
      onChanged()
    } catch (err: any) {
      toast.error(err.message)
    }
  }
  const remove = async (userId: string) => {
    setTeamMembers((prev) => prev.filter((m) => m.userId !== userId))
    try {
      await removeTeamMember(workspaceId, team.id, userId)
      onChanged()
    } catch (err: any) {
      toast.error(err.message)
      load()
    }
  }
  const saveName = async () => {
    const n = editName.trim()
    if (!n || n === team.name) { setEditing(false); return }
    try {
      await onRename(workspaceId, team.id, n)
      setEditing(false)
      onChanged()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <div className="overflow-hidden rounded-soft border border-edge">
      <div className="flex items-center gap-3 bg-elevated/30 px-3 py-2.5">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open}>
          <ChevronDown width={14} height={14} className={`shrink-0 text-ink-faint transition-transform ${open ? '' : '-rotate-90'}`} />
          {editing ? (
            <Input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveName() } }}
              className="!py-1"
            />
          ) : (
            <span className="truncate text-[13px] font-medium text-ink">{team.name}</span>
          )}
          <span className="shrink-0 rounded bg-edge px-1.5 py-0.5 text-[10px] text-ink-dim">{team.memberCount}</span>
        </button>
        {canManage && (
          editing ? (
            <TextButton className="shrink-0" onClick={saveName}>Save</TextButton>
          ) : (
            <>
              <TextButton tone="faint" className="shrink-0" onClick={() => { setEditName(team.name); setEditing(true) }}>Rename</TextButton>
              <IconButton size="sm" onClick={onRemove} aria-label={`Delete ${team.name}`} className="shrink-0 hover:!text-red">
                <TrashIcon width={15} height={15} />
              </IconButton>
            </>
          )
        )}
      </div>

      {open && (
        <div className="border-t border-edge bg-card p-3">
          {canManage && (
            <div className="mb-3">
              {addable.length === 0 ? (
                <div className="rounded-soft border border-edge bg-elevated/40 px-3 py-2 text-center text-[11px] text-ink-faint">
                  All members added
                </div>
              ) : (
                <>
                  <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search members to add…" />
                  {q && (
                    matches.length === 0 ? (
                      <p className="mt-1 px-1 py-2 text-[11px] text-ink-faint">No members match “{query}”.</p>
                    ) : (
                      <div className="mt-1 flex max-h-48 flex-col divide-y divide-edge overflow-y-auto rounded-soft border border-edge">
                        {matches.map((m) => (
                          <button
                            type="button"
                            key={m.userId}
                            onClick={() => add(m.userId)}
                            className="flex items-center gap-2.5 bg-elevated/30 px-3 py-2 text-left hover:bg-card-hover"
                          >
                            <PersonRow name={m.name} email={m.email} emailClassName="hidden sm:block" />
                            <PlusSmall width={13} height={13} className="shrink-0 text-ink-faint" />
                          </button>
                        ))}
                      </div>
                    )
                  )}
                </>
              )}
            </div>
          )}
          {!loaded ? (
            <LoadingState className="py-3 text-center" />
          ) : teamMembers.length === 0 ? (
            <p className="py-2 text-center text-[12px] text-ink-faint">No members in this team yet.</p>
          ) : (
            <div className="flex flex-col divide-y divide-edge overflow-hidden rounded-soft border border-edge">
              {teamMembers.map((m) => (
                <div key={m.userId} className="flex items-center gap-2.5 bg-elevated/30 px-3 py-2">
                  <PersonRow name={m.name} email={m.email} />
                  {canManage && (
                    <TextButton tone="faint" className="shrink-0 hover:!text-red" onClick={() => remove(m.userId)} aria-label={`Remove ${m.email}`}>
                      <TrashIcon width={14} height={14} />
                    </TextButton>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
