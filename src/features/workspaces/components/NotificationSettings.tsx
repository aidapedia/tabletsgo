import { useEffect, useRef, useState } from 'react'
import { useToast } from '@/shared/ui/feedback/Toast'
import Toggle from '@/shared/ui/form/Toggle'
import CheckboxRow from '@/shared/ui/form/CheckboxRow'
import SettingRow from '@/shared/ui/form/SettingRow'
import PersonRow from '@/shared/ui/PersonRow'
import { toggleId } from '@/shared/lib/toggleId'
import { useWorkspaces, updateWorkspace, listMembers, type Member } from '@/features/workspaces'
import LoadingState from '@/shared/ui/feedback/LoadingState'

// How long to wait after the last edit before persisting — ticking through a
// member list would otherwise be one request per checkbox.
const SAVE_DEBOUNCE_MS = 600

type BackupFailureConfig = { enabled: boolean; memberIds: string[] }

// Backup-failure email notifications for this workspace. Any member sees the
// current state; only admins can change it. Same shape as Settings > Data:
// row cards, and changes apply as you make them (no Save button).
export default function NotificationSettings({ workspaceId }: { workspaceId: string }) {
  const toast = useToast()
  const { current, refresh } = useWorkspaces()
  const [members, setMembers] = useState<Member[]>([])
  const [enabled, setEnabled] = useState(false)
  const [memberIds, setMemberIds] = useState<string[]>([])
  // Last config the server accepted — what a failed save rolls back to.
  const savedRef = useRef<BackupFailureConfig>({ enabled: false, memberIds: [] })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    listMembers(workspaceId).then(setMembers)
  }, [workspaceId])

  // Seed from the workspace record. Keyed on the id, not the whole record, so a
  // post-save refresh can't clobber an edit that's still being typed.
  useEffect(() => {
    const cfg = current?.notifications?.backupFailure
    const next = { enabled: !!cfg?.enabled, memberIds: cfg?.memberIds || [] }
    setEnabled(next.enabled)
    setMemberIds(next.memberIds)
    savedRef.current = next
  }, [current?.id])

  // Drop a pending save when the panel unmounts — it would write a value the
  // user can no longer see.
  useEffect(() => () => timerRef.current && clearTimeout(timerRef.current), [])

  if (!current) return <LoadingState className="" />
  const isOwner = current.role === 'owner'

  const queueSave = (next: BackupFailureConfig) => {
    setEnabled(next.enabled)
    setMemberIds(next.memberIds)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      const previous = savedRef.current
      savedRef.current = next
      try {
        await updateWorkspace(workspaceId, { notifications: { backupFailure: next } })
        await refresh()
      } catch (err: any) {
        savedRef.current = previous
        setEnabled(previous.enabled)
        setMemberIds(previous.memberIds)
        toast.error(err.message)
      }
    }, SAVE_DEBOUNCE_MS)
  }

  const toggleEnabled = (on: boolean) => queueSave({ enabled: on, memberIds })
  const toggleMember = (userId: string) => queueSave({ enabled, memberIds: toggleId(memberIds, userId) })

  return (
    <div className="space-y-3">
      <SettingRow
        title="Notify on backup failure"
        desc={
          <>
            Email the selected members whenever a scheduled backup ends up failed (after any configured retries).
            {!isOwner && ' Only workspace admins can change this.'}
          </>
        }
      >
        <Toggle checked={enabled} onChange={toggleEnabled} disabled={!isOwner} ariaLabel="Notify on backup failure" />
      </SettingRow>

      {enabled && (
        <div className="rounded-card border border-edge bg-card p-4">
          <div className="mb-2 text-[12px] font-medium text-ink">Notify these members</div>
          {members.length === 0 ? (
            <p className="text-[12px] text-ink-faint">No members yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {members.map((m) => (
                <CheckboxRow
                  key={m.userId}
                  checked={memberIds.includes(m.userId)}
                  onChange={() => toggleMember(m.userId)}
                  disabled={!isOwner}
                  ariaLabel={m.email}
                >
                  <PersonRow name={m.name} email={m.email} />
                </CheckboxRow>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
