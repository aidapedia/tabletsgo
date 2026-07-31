import { useEffect, useState } from 'react'
import { useToast } from '@/shared/ui/feedback/Toast'
import Toggle from '@/shared/ui/form/Toggle'
import CheckboxRow from '@/shared/ui/form/CheckboxRow'
import Button from '@/shared/ui/buttons/Button'
import PersonRow from '@/shared/ui/PersonRow'
import { toggleId } from '@/shared/lib/toggleId'
import { useWorkspaces, updateWorkspace, listMembers, type Member } from '@/features/workspaces'
import LoadingState from '@/shared/ui/feedback/LoadingState'

// Backup-failure email notifications for this workspace. Any member sees the
// current state; only admins can change it.
export default function NotificationSettings({ workspaceId }: { workspaceId: string }) {
  const toast = useToast()
  const { current, refresh } = useWorkspaces()
  const [members, setMembers] = useState<Member[]>([])
  const [enabled, setEnabled] = useState(false)
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    listMembers(workspaceId).then(setMembers)
  }, [workspaceId])

  useEffect(() => {
    const cfg = current?.notifications?.backupFailure
    setEnabled(!!cfg?.enabled)
    setMemberIds(cfg?.memberIds || [])
  }, [current])

  if (!current) return <LoadingState className="" />
  const isOwner = current.role === 'owner'

  const toggleMember = (userId: string) => setMemberIds((prev) => toggleId(prev, userId))

  const save = async () => {
    setSaving(true)
    try {
      await updateWorkspace(workspaceId, { notifications: { backupFailure: { enabled, memberIds } } })
      await refresh()
      toast.success('Notification settings saved.')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 rounded-card border border-edge bg-card p-4">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">Notify on backup failure</div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">
            Email the selected members whenever a scheduled backup ends up failed (after any configured retries).
            {!isOwner && ' Only workspace admins can change this.'}
          </p>
        </div>
        <Toggle checked={enabled} onChange={setEnabled} disabled={!isOwner} ariaLabel="Notify on backup failure" />
      </div>

      {enabled && (
        <div className="rounded-card border border-edge bg-card p-4">
          <div className="mb-2 text-[12px] font-medium text-ink">Notify these members</div>
          {members.length === 0 ? (
            <p className="text-[12px] text-ink-faint">No members yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {members.map((m) => (
                <CheckboxRow key={m.userId} checked={memberIds.includes(m.userId)} onChange={() => toggleMember(m.userId)} disabled={!isOwner} ariaLabel={m.email}>
                  <PersonRow name={m.name} email={m.email} />
                </CheckboxRow>
              ))}
            </div>
          )}
        </div>
      )}

      {isOwner && (
        <Button variant="primary" size="sm" className="self-start" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      )}
    </div>
  )
}
