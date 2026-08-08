import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/features/auth'
import { listMembers, type Member } from '@/features/workspaces/api'
import { safeRequest } from '@/shared/api/request'
import Button from '@/shared/ui/buttons/Button'
import Select from '@/shared/ui/form/Select'
import { controlClass } from '@/shared/ui/form/Input'
import Toggle from '@/shared/ui/form/Toggle'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { useToast } from '@/shared/ui/feedback/Toast'
import { addGrant, fetchResourceTree } from '../api'
import type { GrantableRole, PrincipalType, ResourceNode } from '../types'

/**
 * The one way access is *created* on a node.
 *
 * The role list is filtered by the node's type before it ever reaches the user:
 * `grantableOn` is the server's own answer to the same requirement criteria it
 * will apply on save, so the form can't offer a grant that would be refused.
 *
 * Principals come from the node's workspace — a grant is only meaningful to
 * someone who is in it. A principal is a person or a *group*: granting a group
 * hands the role to whoever is on its roster, which is edited separately (and
 * under a different permission) because that roster is what the grant reaches.
 * The application root has no workspace, so it takes no grants through this
 * form; ownership is how you hold the root.
 */
export default function GrantForm({
  node,
  roles,
  onDone,
  onChanged,
}: {
  node: ResourceNode
  roles: GrantableRole[]
  onDone: () => void
  onChanged: () => void
}) {
  const toast = useToast()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [members, setMembers] = useState<Member[] | null>(null)
  const [groups, setGroups] = useState<ResourceNode[] | null>(null)
  const [principal, setPrincipal] = useState('')
  const [roleSlug, setRoleSlug] = useState('')
  const [inherit, setInherit] = useState(true)
  const [saving, setSaving] = useState(false)

  const grantable = useMemo(() => roles.filter((r) => r.grantableOn.includes(node.type)), [roles, node.type])

  // Select takes a flat option list, so people and groups are distinguished by a
  // suffix rather than an optgroup. The `type:id` value is what the API wants.
  const principalOptions = useMemo(
    () => [
      ...(members || []).map((m) => ({ value: `user:${m.userId}`, label: m.name || m.email })),
      ...(groups || []).map((g) => ({ value: `node:${g.id}`, label: `${g.name} (group)` })),
    ],
    [members, groups]
  )

  // Principals are workspace-scoped, and only a node inside a workspace has any.
  //
  // An instance admin holds no membership, so the member-scoped routes 403 for
  // them — they read the workspace's people through the admin route instead.
  // Groups come from the tree itself (a group *is* a node), filtered to this
  // workspace because that is exactly what the server will accept. The two loads
  // are independent so one failing never blanks the other.
  useEffect(() => {
    if (!node.workspaceId) return
    const wsId = node.workspaceId
    let alive = true

    const loadMembers = isAdmin
      ? safeRequest<Member[]>(`/admin/workspaces/${wsId}/members`, [])
      : listMembers(wsId).catch(() => [] as Member[])

    loadMembers.then((m) => alive && setMembers(m))
    fetchResourceTree().then((nodes) => {
      if (!alive) return
      setGroups(nodes.filter((n) => n.type === 'group' && n.workspaceId === wsId && !n.context))
    })

    return () => {
      alive = false
    }
  }, [node.workspaceId, isAdmin])

  const submit = async () => {
    if (!principal || !roleSlug) return
    const [principalType, principalId] = principal.split(':') as [PrincipalType, string]
    setSaving(true)
    try {
      await addGrant(node.id, { principalType, principalId, roleSlug, inherit })
      toast.success('Access granted.')
      onDone()
      onChanged()
    } catch (error: any) {
      // The server's refusal names the criterion that failed — show it verbatim
      // rather than a generic failure, it's the only actionable part.
      toast.error(error?.message || 'Could not grant access.')
    } finally {
      setSaving(false)
    }
  }

  // The box carries no background of its own: `controlClass` fields are
  // `bg-elevated`, so tinting it the same colour would flatten them into it.
  return (
    <div className="mb-2 flex flex-col gap-2 rounded-[7px] border border-edge p-2.5">
      {members === null ? (
        <LoadingState className="py-2 text-center" />
      ) : (
        <>
          {/* Select brings layout only — the field look comes from controlClass,
              the same way every other Select in the app gets it. */}
          <Select
            value={principal}
            onChange={setPrincipal}
            placeholder="Who…"
            options={principalOptions}
            className={controlClass}
          />

          <Select
            value={roleSlug}
            onChange={setRoleSlug}
            placeholder="Role…"
            options={grantable.map((r) => ({ value: r.slug, label: r.name }))}
            className={controlClass}
            disabled={!grantable.length}
          />
          {!grantable.length && (
            <p className="text-[10px] leading-relaxed text-ink-faint">
              No role can be granted on a {node.type}. A role's permissions decide where it means anything — widen one in
              Administration → Roles.
            </p>
          )}

          <label className="flex items-center gap-2 text-[11px] text-ink-dim">
            <Toggle checked={inherit} onChange={setInherit} ariaLabel="Apply to everything inside this node" />
            Applies to everything inside this node
          </label>

          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={!principal || !roleSlug || saving}>
              {saving ? 'Granting…' : 'Grant'}
            </Button>
            <Button size="sm" variant="subtle" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
