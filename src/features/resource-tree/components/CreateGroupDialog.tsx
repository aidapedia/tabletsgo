import { useMemo, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import { useToast } from '@/shared/ui/feedback/Toast'
import { Form, FormField } from '@/shared/ui/form/Form'
import { Input } from '@/shared/ui/form/Input'
import Modal from '@/shared/ui/overlay/Modal'
import { createGroup } from '../api'
import { TYPE_LABEL } from '../lib/tree'
import type { ResourceNode } from '../types'
import Breadcrumb from '@/shared/ui/navigation/Breadcrumb'
import NodeIcon from './NodeIcon'

/**
 * Name a new group before it exists.
 *
 * The inline row this replaced named it where it would live, which answered
 * "under what" and nothing else. A group is a folder *and* a roster, and the two
 * things that decide whether you want it here — the full path it will sit at,
 * and the fact that it starts out inheriting whatever was granted above it —
 * were both invisible at the moment of the decision. So the dialog shows the
 * path it is about to occupy, ancestor by ancestor, with the typed name in place
 * as the last segment.
 *
 * The trail comes from the parent's materialized `path`, resolved against the
 * payload the tree already has. A member sees a sparse slice, so an ancestor id
 * with no node in that slice is left out rather than rendered as a placeholder —
 * the visible trail is the honest one.
 */
export default function CreateGroupDialog({
  parent,
  nodes,
  onClose,
  onCreated,
}: {
  /** The group the new one is filed into. */
  parent: ResourceNode
  /** The flat tree as the server sent it — the path trail is resolved from here. */
  nodes: ResourceNode[]
  onClose: () => void
  onCreated: (node: ResourceNode) => void
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  // Root-first ancestors of the parent, plus the parent itself: exactly the
  // segments that will precede the new group.
  const trail = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const ancestors = parent.path
      .split('/')
      .filter(Boolean)
      .slice(0, -1)
      .map((id) => byId.get(id))
      .filter(Boolean) as ResourceNode[]
    return [...ancestors, parent]
  }, [nodes, parent])

  const trimmed = name.trim()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const created = await createGroup(parent.id, trimmed)
      toast.success(`Group created in ${parent.name}.`)
      onCreated(created)
    } catch (error: any) {
      toast.error(error?.message || 'Could not create the group.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`New group in "${parent.name}"`} onClose={onClose} width={480}>
      <Form onSubmit={submit}>
        <FormField label="Name" htmlFor="new-group-name">
          <Input
            id="new-group-name"
            autoFocus
            value={name}
            placeholder="e.g. Production"
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>

        <FormField label="Where it will live">
          <Breadcrumb
            className="rounded-[10px] border border-edge bg-elevated px-2.5 py-2"
            size="sm"
            items={[
              ...trail.map((n) => ({ id: n.id, label: n.name, icon: <NodeIcon type={n.type} size={13} /> })),
              // Placeholder rather than an empty gap: the last segment is the
              // point of the preview, so it has to read as a segment even
              // before there's a name to put in it.
              { id: 'new', label: trimmed || 'new group', icon: <NodeIcon type="group" size={13} />, placeholder: !trimmed },
            ]}
          />
        </FormField>

        <p className="text-[11px] leading-relaxed text-ink-faint">
          It starts empty and inherits whatever has been granted on{' '}
          <span className="text-ink-dim">{parent.name}</span>
          {parent.type !== 'group' ? ` (${TYPE_LABEL[parent.type].toLowerCase()})` : ''} and above. Everyone you add to
          its roster can open the connections you file inside it, so staffing the group is how you scope access to them.
        </p>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-edge pt-3">
          <Button type="button" variant="subtle" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!trimmed || busy}>
            {busy ? 'Creating…' : 'Create group'}
          </Button>
        </div>
      </Form>
    </Modal>
  )
}
