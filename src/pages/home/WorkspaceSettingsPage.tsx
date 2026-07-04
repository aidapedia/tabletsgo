import { useNavigate, useParams } from 'react-router-dom'
import { useWorkspaces, MembersPanel, SmtpSettings, WorkspaceGeneral } from '@/features/workspaces'
import { SubHead, TabbedSection } from './ui'

// Workspace section — General / Member / SMTP as tabs (a second path segment).
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
      id: 'smtp',
      label: 'SMTP',
      body: (
        <div>
          <SubHead title="SMTP" desc="Configure the mail server used to send member-invite emails." />
          {isAdmin ? (
            current ? (
              <SmtpSettings workspaceId={current.id} />
            ) : (
              <div className="text-xs text-ink-faint">Loading…</div>
            )
          ) : (
            <p className="text-[12px] text-ink-faint">Only workspace admins can change email settings.</p>
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
