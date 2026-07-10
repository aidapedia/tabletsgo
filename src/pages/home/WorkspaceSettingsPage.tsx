import { useNavigate, useParams } from 'react-router-dom'
import { useWorkspaces, MembersPanel, WorkspaceGeneral, IntegrationsSettings, NotificationSettings } from '@/features/workspaces'
import { SubHead, TabbedSection } from './ui'

// Workspace section — General / Member / Integrations / Notification as tabs
// (a second path segment). SMTP + S3 Storage live together under
// Integrations; Notification is not a separate sidebar item.
export default function WorkspaceSettingsPage() {
  const navigate = useNavigate()
  const { sub } = useParams()
  const { current } = useWorkspaces()
  const isAdmin = current?.role === 'admin'

  const tabs = [
    {
      id: 'general',
      label: 'General',
      body: (
        <div>
          <SubHead title="General" desc="Manage the general settings of this workspace." />
          <WorkspaceGeneral />
        </div>
      ),
    },
    {
      id: 'member',
      label: 'Member',
      body: (
        <div>
          <SubHead title="Members" desc="Invite teammates and manage who can access this workspace." />
          {current ? (
            <MembersPanel workspaceId={current.id} canManage={isAdmin} />
          ) : (
            <div className="text-xs text-ink-faint">Loading…</div>
          )}
        </div>
      ),
    },
    {
      id: 'integrations',
      label: 'Integrations',
      body: (
        <div>
          <SubHead title="Integrations" desc="External services this workspace connects to." />
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
      title="Workspace"
      desc={`Manage ${current?.name || 'your workspace'} and its members.`}
      tabs={tabs}
      active={sub || ''}
      onTab={(id) => navigate(`/workspace/${id}`)}
    />
  )
}
