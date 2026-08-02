import { useEffect, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import CheckboxRow from '@/shared/ui/form/CheckboxRow'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { useToast } from '@/shared/ui/feedback/Toast'
import { Input, Textarea } from '@/shared/ui/form/Input'
import { Label } from '@/shared/ui/form/Form'
import Badge from '@/shared/ui/Badge'
import { EditIcon, PlusIcon, TrashIcon } from '@/shared/ui/icons'
import { listRoles, type Permission, type PermissionGroup, type Role } from '@/features/workspaces'
import { createRole, deleteRole, listPermissionCatalog, updateRole } from '../api'

/**
 * Admin → Roles: the workspace access model, defined once for the instance.
 *
 * A role is a named set of permissions; a workspace owner then assigns their
 * people to one. The permission list comes from the server's catalog rather than
 * being hardcoded here, so the editor can only ever offer something a route
 * actually enforces.
 *
 * Two rules the server also enforces, surfaced here so they don't arrive as a
 * failed save: a built-in role can't be deleted (memberships reference its slug),
 * and `owner` always keeps "Manage workspace" — a workspace whose owners can't
 * manage it is one nobody can fix.
 */
export default function AdminRolesPanel() {
  const toast = useToast()
  const [roles, setRoles] = useState<Role[]>([])
  const [catalog, setCatalog] = useState<PermissionGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Role | 'new' | null>(null)
  const [removing, setRemoving] = useState<Role | null>(null)

  const load = () => {
    setLoading(true)
    Promise.all([listRoles(), listPermissionCatalog()]).then(([r, c]) => {
      setRoles(r)
      setCatalog(c)
      setLoading(false)
    })
  }
  useEffect(load, [])

  const confirmRemove = async () => {
    const role = removing
    setRemoving(null)
    if (!role) return
    try {
      await deleteRole(role.slug)
      toast.success(`Deleted the ${role.name} role.`)
      load()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  if (loading) return <LoadingState className="" />

  if (editing) {
    return (
      <RoleEditor
        role={editing === 'new' ? null : editing}
        catalog={catalog}
        onDone={(message) => {
          setEditing(null)
          if (message) {
            toast.success(message)
            load()
          }
        }}
      />
    )
  }

  const labelFor = (key: Permission) => catalog.flatMap((g) => g.items).find((i) => i.key === key)?.label || key

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Label className="!mb-0">Roles ({roles.length})</Label>
        <Button variant="primary" size="sm" icon={PlusIcon} onClick={() => setEditing('new')}>
          New role
        </Button>
      </div>

      {roles.length === 0 ? (
        <EmptyState>No roles yet.</EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {roles.map((role) => (
            <div key={role.slug} className="rounded-card border border-edge bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-bold text-ink">{role.name}</span>
                    {role.builtin && <Badge tone="neutral">built-in</Badge>}
                  </div>
                  {role.description && <p className="mt-1 text-[11px] text-ink-dim">{role.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <TextButton onClick={() => setEditing(role)} aria-label={`Edit ${role.name}`}>
                    <EditIcon width={15} height={15} />
                  </TextButton>
                  {/* Built-ins stay: memberships store the slug, so deleting one
                      would leave those people with no role at all. */}
                  {!role.builtin && (
                    <TextButton tone="faint" className="hover:!text-red" onClick={() => setRemoving(role)} aria-label={`Delete ${role.name}`}>
                      <TrashIcon width={15} height={15} />
                    </TextButton>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {role.permissions.length === 0 ? (
                  <span className="text-[11px] text-ink-faint">
                    No workspace permissions — can still open the connections they’re granted, and manage the ones they own.
                  </span>
                ) : (
                  role.permissions.map((p) => (
                    <span key={p} className="rounded-[7px] border border-edge bg-elevated px-2 py-0.5 text-[10px] text-ink-dim">
                      {labelFor(p)}
                    </span>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {removing && (
        <ConfirmDialog
          title={`Delete the ${removing.name} role?`}
          message="Workspaces can no longer assign it. If anyone still holds this role, the delete is refused — move them first."
          confirmLabel="Delete"
          danger
          onConfirm={confirmRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </>
  )
}

// Create or edit one role: name, description, and the permission matrix.
function RoleEditor({ role, catalog, onDone }: { role: Role | null; catalog: PermissionGroup[]; onDone: (message?: string) => void }) {
  const toast = useToast()
  const [name, setName] = useState(role?.name || '')
  const [description, setDescription] = useState(role?.description || '')
  const [permissions, setPermissions] = useState<Permission[]>(role?.permissions || [])
  const [saving, setSaving] = useState(false)

  // The one permission `owner` can't give up — the server puts it back anyway, so
  // the checkbox is locked rather than silently overridden on save.
  const locked = (key: Permission) => role?.slug === 'owner' && key === 'workspace.manage'

  const toggle = (key: Permission) =>
    setPermissions((prev) => (prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]))

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      if (role) {
        await updateRole(role.slug, { name: name.trim(), description: description.trim(), permissions })
        onDone(`Saved the ${name.trim()} role.`)
      } else {
        await createRole({ name: name.trim(), description: description.trim(), permissions })
        onDone(`Created the ${name.trim()} role.`)
      }
    } catch (err: any) {
      toast.error(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="max-w-[420px]">
        <Label>Role name</Label>
        <Input value={name} placeholder="e.g. Data Analyst" onChange={(e) => setName(e.target.value)} />
        {role && (
          <p className="mt-1.5 text-[10px] text-ink-faint">
            Members reference this role as <span className="font-mono">{role.slug}</span>, which never changes — renaming is safe.
          </p>
        )}
      </div>

      <div className="max-w-[420px]">
        <Label>Description</Label>
        <Textarea rows={2} value={description} placeholder="What this role is for." onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div>
        <Label>Permissions</Label>
        <div className="flex flex-col gap-4">
          {catalog.map((group) => (
            <div key={group.group}>
              <div className="mb-2 text-[11px] font-medium text-ink-dim">{group.group}</div>
              <div className="flex flex-col gap-2">
                {group.items.map((item) => (
                  <CheckboxRow
                    key={item.key}
                    checked={permissions.includes(item.key) || locked(item.key)}
                    disabled={locked(item.key)}
                    onChange={() => toggle(item.key)}
                    ariaLabel={item.label}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] text-ink">{item.label}</span>
                      <span className="block text-[10px] text-ink-faint">{item.description}</span>
                    </span>
                    {locked(item.key) && <Badge tone="neutral" className="shrink-0">required</Badge>}
                  </CheckboxRow>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[10px] text-ink-faint">
          Opening a database isn’t listed here: that’s granted per connection, on the connection’s Access tab.
        </p>
      </div>

      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={save} disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : role ? 'Save role' : 'Create role'}
        </Button>
        <Button variant="subtle" size="sm" onClick={() => onDone()} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
