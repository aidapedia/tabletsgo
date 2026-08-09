import { useEffect, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import Select from '@/shared/ui/form/Select'
import { Input, controlClass } from '@/shared/ui/form/Input'
import { FormField } from '@/shared/ui/form/Form'
import { useToast } from '@/shared/ui/feedback/Toast'
import Modal from '@/shared/ui/overlay/Modal'
import { CopyIcon } from '@/shared/ui/icons'
import { createWorkspaceAs, listUsers, type AdminUser } from '../api'

// A workspace needs an owner to be useful, so the owner is part of creating one
// rather than a follow-up step. The owner is picked from the accounts that
// already exist — creating a person as a side effect of creating a workspace
// made accounts appear that nobody had reviewed, so the admin creates the user
// on the Users tab first. A picked account may still be `pending`, in which
// case the server hands back their invite link.
export default function CreateWorkspaceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  useEffect(() => {
    listUsers().then((list) => {
      setUsers(list)
      setLoading(false)
    })
  }, [])

  // Instance admins hold no workspace membership, so they can't own one.
  const candidates = users.filter((u) => u.role !== 'admin')
  const owner = candidates.find((u) => u.id === ownerId)

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim() || !owner) return
    setSaving(true)
    try {
      const { inviteLink: link, emailed } = await createWorkspaceAs(name.trim(), owner.email)
      if (link) {
        setInviteLink(link)
        toast.success(emailed ? 'Workspace created. Invite emailed to the owner.' : 'Workspace created — share the invite link.')
      } else {
        toast.success('Workspace created.')
        onCreated()
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="New workspace" onClose={inviteLink ? onCreated : onClose}>
      {inviteLink ? (
        <div>
          <p className="text-[12px] leading-relaxed text-ink-dim">
            The owner hasn’t set a password yet. Send them this link so they can set one and take over the workspace.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-soft border border-edge bg-elevated px-2.5 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-dim">{inviteLink}</span>
            <TextButton
              className="shrink-0"
              aria-label="Copy invite link"
              onClick={() => {
                navigator.clipboard?.writeText(inviteLink)
                toast.success('Invite link copied.')
              }}
            >
              <CopyIcon width={15} height={15} />
            </TextButton>
          </div>
          <div className="mt-5 flex justify-end">
            <Button variant="primary" size="sm" onClick={onCreated}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <FormField label="Workspace name">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Production" />
          </FormField>
          <FormField
            label="Owner"
            hint="They manage the workspace: members, groups and connections. Search by name or email."
          >
            {loading ? (
              <div className={`${controlClass} text-ink-faint`}>Loading accounts…</div>
            ) : candidates.length === 0 ? (
              <p className="rounded-soft border border-dashed border-edge-strong px-3 py-4 text-center text-[11px] text-ink-dim">
                No accounts yet — create the owner's user on the Users tab first, then come back.
              </p>
            ) : (
              <Select
                portal // the modal body scrolls, which would clip the menu
                className={controlClass}
                value={ownerId}
                placeholder="Search people…"
                searchable
                searchPlaceholder="Name or email…"
                options={candidates.map((u) => ({
                  value: u.id,
                  label: u.name || u.email,
                  hint: u.name ? u.email : undefined,
                  keywords: u.email,
                }))}
                onChange={setOwnerId}
              />
            )}
          </FormField>
          <div className="mt-5 flex justify-end gap-2">
            <Button size="sm" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={saving || !owner || !name.trim()}>
              {saving ? 'Creating…' : 'Create workspace'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

