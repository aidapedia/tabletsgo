import { useParams } from 'react-router-dom'
import { useWorkspaces, can, MembersPanel, WorkspaceGeneral, WorkspaceConfig } from '@/features/workspaces'
import { Narrow, SubHead, TabbedSection } from './ui'
import useTabRoute from './useTabRoute'
import LoadingState from '@/shared/ui/feedback/LoadingState'

// Workspace section — General / Config / Member as tabs (a second path segment).
// Integration + Notification moved to their own /integrations sidebar section.
//
// There is no Teams tab: a group of people *is* a node in the resource tree, so
// its roster is edited where its grants are, on the group itself.
export default function WorkspaceSettingsPage() {
  const { sub } = useParams()
  const { current } = useWorkspaces()
  const canManageMembers = can(current, 'members.manage')

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
