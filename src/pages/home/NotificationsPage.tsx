import { useEffect, useState } from 'react'
import { useWorkspaces, NotificationSettings, getWorkspace, type InstanceSmtp } from '@/features/workspaces'
import { Narrow, Section } from './ui'
import LoadingState from '@/shared/ui/feedback/LoadingState'

// Notification section — the emails Tabletsgo sends for this workspace. The
// mail server itself is instance-level (an admin owns it under Administration →
// Email), so this page only reports which one is in effect.
export default function NotificationsPage() {
  const { current } = useWorkspaces()
  const [smtp, setSmtp] = useState<InstanceSmtp | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!current || current.role !== 'owner') return
    getWorkspace(current.id).then((w) => {
      setSmtp(w.smtp || null)
      setChecked(true)
    })
  }, [current?.id, current?.role])

  return (
    <Section title="Notification" desc="Manage the notifications Tabletsgo sends to your team.">
      {current ? (
        <Narrow>
          {checked && (
            <p className="mb-5 text-[12px] text-ink-dim">
              {smtp
                ? `Email is sent through this instance’s mail server (${smtp.host}). Your administrator configures it.`
                : 'This instance has no mail server configured, so nothing can be emailed — ask an administrator to set one up. Member invites still work as copyable links.'}
            </p>
          )}
          <NotificationSettings workspaceId={current.id} />
        </Narrow>
      ) : (
        <LoadingState className="" />
      )}
    </Section>
  )
}
