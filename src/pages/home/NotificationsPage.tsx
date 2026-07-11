import { useNavigate, useParams } from 'react-router-dom'
import { useWorkspaces, IntegrationsSettings, NotificationSettings } from '@/features/workspaces'
import { SubHead, TabbedSection } from './ui'

// Notification section — Integration / Notification as tabs (a second path
// segment). Holds external-service settings and the notifications Tabletsgo
// sends; lives as its own top-level home section.
export default function NotificationsPage() {
  const navigate = useNavigate()
  const { sub } = useParams()
  const { current } = useWorkspaces()

  const tabs = [
    {
      id: 'smtp',
      label: 'SMTP',
      body: (
        <div>
          <SubHead title="SMTP" desc="Configure the mail server used to send notifications and member-invite emails." />
          <IntegrationsSettings />
        </div>
      ),
    },
    {
      id: 'notification',
      label: 'Notification',
      body: (
        <div>
          <SubHead title="Notification" desc="Manage the notifications Tabletsgo sends to your team." />
          {current ? <NotificationSettings workspaceId={current.id} /> : <div className="text-xs text-ink-faint">Loading…</div>}
        </div>
      ),
    },
  ]

  return (
    <TabbedSection
      title="Notification"
      desc="Connect external services and manage notifications for this workspace."
      tabs={tabs}
      active={sub || ''}
      onTab={(id) => navigate(`/notifications/${id}`)}
    />
  )
}
