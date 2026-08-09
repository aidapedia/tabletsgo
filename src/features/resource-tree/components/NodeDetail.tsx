import { useState } from 'react'
import Badge from '@/shared/ui/Badge'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import { Input } from '@/shared/ui/form/Input'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CloseIcon, EditIcon, FolderPlusIcon, MoveIcon, TrashIcon } from '@/shared/ui/icons'
import { useAuth } from '@/features/auth'
import { CreateWorkspaceDialog } from '@/features/admin'
import { createGroup, deleteNode, renameNode } from '../api'
import { canHold, TYPE_LABEL } from '../lib/tree'
import type { GrantableRole, NodeDetail as NodeDetailData, NodeTypeMeta, ResourceNode } from '../types'
import NodePeople from './NodePeople'
import MoveNodeDialog from './MoveNodeDialog'
import NodeIcon from './NodeIcon'

/**
 * Everything about one node: where it sits, what it holds, who may do what here,
 * and what the caller themselves may do.
 *
 * The two buttons that change the tree — new group, delete — appear only for the
 * types a user actually creates. A workspace or connection node follows its own
 * resource, so renaming it here would just drift from the thing it mirrors; the
 * panel says so instead of offering a control that fails.
 *
 * Moving is the exception to that rule: a mirrored node is exactly what you
 * re-file (a connection into the group that scopes access to it), because where
 * a node *sits* is the tree's business and not the mirrored row's.
 */
export default function NodeDetail({
  detail,
  loading,
  roles,
  nodes,
  nodeTypes,
  onClose,
  onOpen,
  onSelect,
  onChanged,
}: {
  detail: NodeDetailData | null
  loading: boolean
  roles: GrantableRole[]
  /** The flat tree and the node-type catalog — what the move picker offers. */
  nodes: ResourceNode[]
  nodeTypes: NodeTypeMeta[]
  onClose: () => void
  onOpen: (node: ResourceNode) => void
  onSelect: (nodeId: string) => void
  onChanged: () => void
}) {
  const toast = useToast()
  const { user } = useAuth()
  const [creating, setCreating] = useState(false)
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [moving, setMoving] = useState(false)
  const [busy, setBusy] = useState(false)

  if (loading) return <LoadingState className="py-16 text-center" />
  if (!detail) return <EmptyState className="py-16">Select a node to see its access.</EmptyState>

  const { node, context, ancestors, children, grants, members, people, permissions, owner } = detail
  const isCustomGroup = node.type === 'group'
  const canOrganise = permissions.includes('resources.organise')
  const canGrant = permissions.includes('resources.grant')
  // Staffing a group is a grant-strength power, so it asks for its own key —
  // never `resources.organise`, which is only about where things sit. A
  // workspace's roster is its membership, so there it is `members.manage`; the
  // server picks the same way.
  const canManageMembers = permissions.includes(node.type === 'workspace' ? 'members.manage' : 'teams.manage')
  // What may be filed here comes from the catalog's `children` list — the same
  // one the server enforces. Being a group is not enough: the application root
  // is one and holds workspaces only, so it offers "new workspace" instead, and
  // only to the instance admin who can name the owner a workspace needs.
  const canAddGroup = canOrganise && canHold(nodeTypes, node, 'group')
  const canAddWorkspace = canOrganise && canHold(nodeTypes, node, 'workspace') && user?.role === 'admin'
  // Re-filing needs `resources.organise` here *and* at the destination; the
  // picker resolves the far end, this is the near one. The root has nowhere to
  // go, which is the only node that can't move at all — every other node shows
  // the button and, when the permission is missing, says so. Hiding it instead
  // answers "can I move this?" with silence, which reads as a missing feature.
  // A group is deletable only once it is empty: re-filing what it holds is the
  // user's decision, so the server refuses (409) rather than silently moving
  // anything up a level. Surfaced here so the button explains itself.
  const blockedByChildren = children.length > 0

  const submitGroup = async () => {
    if (!groupName.trim()) return
    setBusy(true)
    try {
      await createGroup(node.id, groupName.trim())
      toast.success('Group created.')
      setGroupName('')
      setCreating(false)
      onChanged()
    } catch (error: any) {
      toast.error(error?.message || 'Could not create the group.')
    } finally {
      setBusy(false)
    }
  }

  const submitRename = async () => {
    if (!newName.trim()) return
    setBusy(true)
    try {
      await renameNode(node.id, newName.trim())
      toast.success('Renamed.')
      setRenaming(false)
      onChanged()
    } catch (error: any) {
      toast.error(error?.message || 'Could not rename.')
    } finally {
      setBusy(false)
    }
  }

  const submitDelete = async () => {
    setBusy(true)
    try {
      await deleteNode(node.id)
      toast.success('Group deleted.')
      setConfirmDelete(false)
      onClose()
      onChanged()
    } catch (error: any) {
      toast.error(error?.message || 'Could not delete the group.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-edge p-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-elevated">
          <NodeIcon type={node.type} size={18} className="text-ink-dim" />
        </span>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="flex items-center gap-1.5">
              <Input
                autoFocus
                value={newName}
                onChange={(e: any) => setNewName(e.target.value)}
                onKeyDown={(e: any) => {
                  if (e.key === 'Enter') submitRename()
                  if (e.key === 'Escape') setRenaming(false)
                }}
                className="h-7 text-[13px]"
              />
              <Button size="sm" onClick={submitRename} disabled={busy}>
                Save
              </Button>
            </div>
          ) : (
            <h2 className="truncate text-[14px] font-semibold text-ink">{node.name}</h2>
          )}
          <div className="mt-0.5 flex items-center gap-1.5">
            <p className="text-[11px] text-ink-faint">{TYPE_LABEL[node.type]}</p>
            {/* Ownership is a property of the node, not a row in the access list:
                it is no role, there is nothing to revoke, and it short-circuits to
                every permission. Stated once, here. "Yours" already says it when
                the owner is the caller. */}
            {owner && !node.owned && (
              <p className="min-w-0 truncate text-[11px] text-ink-faint">· Owned by {owner.name || owner.email}</p>
            )}
            {node.owned && <Badge tone="green">Yours</Badge>}
            {node.kind === 'group' && <Badge tone="faint">Group</Badge>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {!!node.parentId && (
            <IconButton
              size="sm"
              onClick={() => setMoving(true)}
              disabled={!canOrganise}
              title={
                canOrganise
                  ? 'Move to another group'
                  : `Moving needs the "Organise resources" permission on this ${TYPE_LABEL[node.type].toLowerCase()} — your role here doesn't carry it.`
              }
              aria-label="Move"
            >
              <MoveIcon width={14} height={14} />
            </IconButton>
          )}
          {isCustomGroup && canOrganise && !renaming && (
            <IconButton
              size="sm"
              onClick={() => {
                setNewName(node.name)
                setRenaming(true)
              }}
              aria-label="Rename group"
            >
              <EditIcon width={14} height={14} />
            </IconButton>
          )}
          {isCustomGroup && canOrganise && (
            <IconButton
              size="sm"
              className="hover:!text-red"
              onClick={() => setConfirmDelete(true)}
              disabled={blockedByChildren}
              title={
                blockedByChildren
                  ? `Move or delete the ${children.length} item${children.length === 1 ? '' : 's'} inside this group first.`
                  : 'Delete group'
              }
              aria-label="Delete group"
            >
              <TrashIcon width={14} height={14} />
            </IconButton>
          )}
          <IconButton size="sm" onClick={onClose} aria-label="Close detail">
            <CloseIcon width={15} height={15} />
          </IconButton>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="space-y-5">
          {/* Where it sits — the chain a grant would cascade down. */}
          {ancestors.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-[11px] text-ink-faint">
              {ancestors.map((a) => (
                <span key={a.id} className="flex items-center gap-1">
                  <button type="button" onClick={() => onSelect(a.id)} className="hover:text-ink-dim hover:underline">
                    {a.name}
                  </button>
                  <span className="opacity-50">/</span>
                </span>
              ))}
              <span className="text-ink-dim">{node.name}</span>
            </div>
          )}

          {/* Scaffolding: the caller holds nothing here, so the server sends no
              grants and no roster — rendering those panels would show an empty
              state that reads as "nobody has access", which is the wrong claim.
              The owner is the one fact still worth stating, because it says who
              to ask. */}
          {context ? (
            <p className="rounded-[7px] border border-edge bg-elevated/30 px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
              You hold nothing on this {TYPE_LABEL[node.type].toLowerCase()} itself — it's here so what you do have access to
              has a path back to the root. Who else can reach it isn't shown
              {owner ? `; it belongs to ${owner.name || owner.email}.` : '.'}
            </p>
          ) : (
            /* One section: who is in this group and what that is worth here,
               then everyone else who reaches it through an ancestor or a group.
               Two tables and two permissions behind it — `NodePeople` keeps each
               block's control over its own. */
            <NodePeople
              node={node}
              people={people || []}
              grants={grants}
              roles={roles}
              members={members || []}
              canGrant={canGrant}
              canManageMembers={canManageMembers}
              onSelect={onSelect}
              onChanged={onChanged}
            />
          )}

          {/* What's inside */}
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <h3 className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                Contains
                {children.length > 0 && <span className="ml-1 font-normal normal-case tracking-normal">({children.length})</span>}
              </h3>
              {canAddGroup && !creating && (
                <IconButton size="sm" className="ml-auto" onClick={() => setCreating(true)} aria-label="New group">
                  <FolderPlusIcon width={14} height={14} />
                </IconButton>
              )}
              {canAddWorkspace && (
                <IconButton
                  size="sm"
                  className="ml-auto"
                  onClick={() => setCreatingWorkspace(true)}
                  aria-label="New workspace"
                >
                  <FolderPlusIcon width={14} height={14} />
                </IconButton>
              )}
            </div>

            {creating && (
              <div className="mb-2 flex items-center gap-1.5">
                <Input
                  autoFocus
                  value={groupName}
                  placeholder="Group name"
                  onChange={(e: any) => setGroupName(e.target.value)}
                  onKeyDown={(e: any) => {
                    if (e.key === 'Enter') submitGroup()
                    if (e.key === 'Escape') setCreating(false)
                  }}
                  className="h-7 text-[12px]"
                />
                <Button size="sm" onClick={submitGroup} disabled={busy || !groupName.trim()}>
                  Add
                </Button>
                <Button size="sm" variant="subtle" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              </div>
            )}

            {children.length === 0 ? (
              <EmptyState className="py-4">
                {context ? 'Nothing here you have access to.' : 'Nothing filed here yet.'}
              </EmptyState>
            ) : (
              <div className="flex flex-col gap-0.5">
                {children.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => (c.kind === 'resource' ? onOpen(c) : onSelect(c.id))}
                    className="flex items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-xs text-ink-dim hover:bg-elevated hover:text-ink"
                  >
                    <NodeIcon type={c.type} size={13} />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="shrink-0 text-[10px] text-ink-faint">{TYPE_LABEL[c.type]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* What the caller may do here — the resolved answer, not their role. */}
          <div>
            <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-faint">Your access here</h3>
            {permissions.length === 0 ? (
              <p className="text-xs text-ink-faint">You can see this node, but hold nothing on it.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {permissions.map((p) => (
                  <Badge key={p} tone="neutral" className="normal-case">
                    {p}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {creatingWorkspace && (
        <CreateWorkspaceDialog
          onClose={() => setCreatingWorkspace(false)}
          onCreated={() => {
            setCreatingWorkspace(false)
            onChanged()
          }}
        />
      )}

      {moving && (
        <MoveNodeDialog
          node={node}
          nodes={nodes}
          nodeTypes={nodeTypes}
          onClose={() => setMoving(false)}
          onMoved={() => {
            setMoving(false)
            onChanged()
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete group"
          message={`Delete "${node.name}"? It is empty, so nothing else is affected.`}
          confirmLabel="Delete"
          danger
          onConfirm={submitDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
