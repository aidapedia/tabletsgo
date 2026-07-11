import { useNavigate, useParams } from 'react-router-dom'
import { useWorkspaces, MembersPanel, WorkspaceGeneral, TeamsPanel } from '@/features/workspaces'
import { SubHead, TabbedSection } from './ui'

// Workspace section — General / Member as tabs (a second path segment).
// Integration + Notification moved to their own /integrations sidebar section.
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
      id: 'teams',
      label: 'Teams',
      body: (
        <div>
          <SubHead title="Teams" desc="Group members into teams to assign connection access and notifications together." />
          {current ? (
            <TeamsPanel workspaceId={current.id} canManage={isAdmin} />
          ) : (
            <div className="text-xs text-ink-faint">Loading…</div>
          )}
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
