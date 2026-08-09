import { useParams } from 'react-router-dom'
import { useWorkspaces, WorkspaceGeneral, WorkspaceConfig } from '@/features/workspaces'
import { Narrow, SubHead, TabbedSection } from './ui'
import useTabRoute from './useTabRoute'

// Workspace section — General / Config as tabs (a second path segment).
// Integration + Notification moved to their own /integrations sidebar section.
//
// Member is not a tab here: it is its own sidebar row (/members), because the
// roster is consulted far more often than the workspace's own settings.
//
// There is no Teams tab either: a group of people *is* a node in the resource
// tree, so its roster is edited where its grants are, on the group itself.
export default function WorkspaceSettingsPage() {
  const { sub } = useParams()
  const { current } = useWorkspaces()

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
  ]

  const { active, onTab } = useTabRoute('/workspace', tabs, sub)

  return (
    <TabbedSection
      title="Workspace"
      desc={`Manage ${current?.name || 'your workspace'} and its settings.`}
      tabs={tabs}
      active={active}
      onTab={onTab}
    />
  )
}
