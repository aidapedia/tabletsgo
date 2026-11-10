import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CopyIcon } from '@/shared/ui/icons'
import { createWorkspaceAs, listUsers, type AdminUser } from '../api'
import { Button } from '@/shared/ui/button'
import { fieldClass } from '@/shared/ui/input'
import OptionSelect from '@/shared/ui/form/OptionSelect'
import { FormField } from '@/shared/ui/form/FormField'
import { Input } from '@/shared/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/dialog'

// A workspace needs an owner to be useful, so the owner is part of creating one
// rather than a follow-up step. The owner is picked from the accounts that
// already exist — creating a person as a side effect of creating a workspace
// made accounts appear that nobody had reviewed, so the admin creates the user
// on the Users tab first. A picked account may still be `pending`, in which
// case the server hands back their invite link.
export default function CreateWorkspaceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
    <Dialog open onOpenChange={(open) => !open && (inviteLink ? onCreated : onClose)()}>
      <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100vh-6rem)] flex-col sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
        </DialogHeader>
        {/* -mx/px so a focus ring inside the body isn't clipped by the scroller. */}
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {inviteLink ? (
            <div>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                The owner hasn’t set a password yet. Send them this link so they can set one and take over the workspace.
              </p>
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted px-2.5 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{inviteLink}</span>
                <Button variant="link" size="inline" type="button"
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  aria-label="Copy invite link"
                  onClick={() => {
                    navigator.clipboard?.writeText(inviteLink)
                    toast.success('Invite link copied.')
                  }}
                >
                  <CopyIcon width={15} height={15} />
                </Button>
              </div>
              <div className="mt-5 flex justify-end">
                <Button variant="default" size="sm" onClick={onCreated}>
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
                  <div className={`${fieldClass} text-faint`}>Loading accounts…</div>
                ) : candidates.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-input px-3 py-4 text-center text-[11px] text-muted-foreground">
                    No accounts yet — create the owner's user on the Users tab first, then come back.
                  </p>
                ) : (
                  <OptionSelect
                     // the modal body scrolls, which would clip the menu
              
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
                <Button variant="outline" size="sm" onClick={onClose} type="button">
                  Cancel
                </Button>
                <Button variant="default" size="sm" type="submit" disabled={saving || !owner || !name.trim()}>
                  {saving ? 'Creating…' : 'Create workspace'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

