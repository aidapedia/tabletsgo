import { useNavigate, useParams } from 'react-router-dom'
import { useWorkspaces, MembersPanel, WorkspaceGeneral, IntegrationsSettings, ExperimentsSettings } from '@/features/workspaces'
import { ComingSoon, SubHead, TabbedSection } from './ui'

// Workspace section — General / Member / Integrations / Notification / Beta as
// tabs (a second path segment). SMTP + S3 Storage live together under
// Integrations; Notification and Beta are no longer separate sidebar items.
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
          <ComingSoon
            title="Notification manager"
            desc="Configure channels and rules for the notifications Tabletsgo sends — landing soon."
          />
        </div>
      ),
    },
    {
      id: 'beta',
      label: 'Beta',
      body: (
        <div>
          <SubHead title="Beta experiments" desc="Turn early-access features on or off for this workspace." />
          <ExperimentsSettings />
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
