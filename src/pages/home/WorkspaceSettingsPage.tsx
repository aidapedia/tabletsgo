import { useParams } from 'react-router-dom'
import { useWorkspaces, can, MembersPanel, WorkspaceGeneral, WorkspaceConfig, TeamsPanel } from '@/features/workspaces'
import { Narrow, SubHead, TabbedSection } from './ui'
import useTabRoute from './useTabRoute'
import LoadingState from '@/shared/ui/feedback/LoadingState'

// Workspace section — General / Config / Member / Teams as tabs (a second path segment).
// Integration + Notification moved to their own /integrations sidebar section.
export default function WorkspaceSettingsPage() {
  const { sub } = useParams()
  const { current } = useWorkspaces()
  // Members and teams are separate capabilities: a role can be given one and not
  // the other, so each tab asks for its own rather than sharing one "is owner".
  const canManageMembers = can(current, 'members.manage')
  const canManageTeams = can(current, 'teams.manage')

  const tabs = [
    {
      id: 'general',
      label: 'General',
      body: (
        <Narrow>
          <SubHead title="General" desc="Manage the general settings of this workspace." />
          <WorkspaceGeneral />
        </Narrow>
      ),
    },
    {
      id: 'config',
      label: 'Config',
      body: (
        <Narrow>
          <SubHead title="Config" desc="Defaults every connection in this workspace inherits." />
          <WorkspaceConfig />
        </Narrow>
      ),
    },
    {
      id: 'member',
      label: 'Member',
      body: (
        <div>
          <SubHead title="Members" desc="Invite teammates and manage who can access this workspace." />
          {current ? (
            <MembersPanel workspaceId={current.id} canManage={canManageMembers} />
          ) : (
            <LoadingState className="" />
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
            <TeamsPanel workspaceId={current.id} canManage={canManageTeams} />
          ) : (
            <LoadingState className="" />
          )}
        </div>
      ),
    },
  ]

  const { active, onTab } = useTabRoute('/workspace', tabs, sub)

  return (
    <TabbedSection
      title="Workspace"
      desc={`Manage ${current?.name || 'your workspace'} and its members.`}
      tabs={tabs}
      active={active}
      onTab={onTab}
    />
  )
}
