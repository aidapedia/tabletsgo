import { useEffect, useState } from 'react'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { PlusIcon } from '@/shared/ui/icons'
import PageHeader from '@/shared/ui/page/PageHeader'
import PageTabs from '@/shared/ui/page/PageTabs'
import { getWorkspaceOverview, type AdminWorkspaceOverview } from '../../api'
import ActivityTab from './ActivityTab'
import ConnectionsTab from './ConnectionsTab'
import MembersTab from './MembersTab'
import OverviewTab from './OverviewTab'
import ResourcesTab from './ResourcesTab'
import SettingsTab from './SettingsTab'
import { formatDate, formatDateTime } from './ui'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'

export const WORKSPACE_DETAIL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'members', label: 'Members' },
  { id: 'connections', label: 'Connections' },
  { id: 'resources', label: 'Resources' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings' },
]

/**
 * One workspace, as an instance admin sees it. An admin never joins a workspace,
 * so this shows what it holds and who runs it, and the levers are the ones that
 * need no membership: its name, its roster, deleting it. There is no way in from
 * here to a connection or a database.
 *
 * The overview is the only request the page itself makes, because the header and
 * two of the tabs read it; each other tab fetches what it shows when it opens.
 */
export default function AdminWorkspaceDetail({
  id,
  tab,
  onTab,
  onBack,
}: {
  id: string
  tab: string
  onTab: (id: string) => void
  onBack: () => void
}) {
  const [overview, setOverview] = useState<AdminWorkspaceOverview | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setOverview(await getWorkspaceOverview(id))
    setLoading(false)
  }
  useEffect(() => {
    setLoading(true)
    load()
  }, [id])

  if (loading) return <LoadingState className="py-20 text-center" />
  if (!overview) {
    return (
      <EmptyState className="py-20">
        This workspace no longer exists.{' '}
        <button className="text-primary hover:underline" onClick={onBack}>
          Back to workspaces
        </button>
      </EmptyState>
    )
  }

  const { workspace, owners } = overview
  const ownerless = owners.length === 0
  const lastActive = workspace.lastActivityAt ? `Last active ${formatDateTime(workspace.lastActivityAt)}` : 'No activity yet'

  return (
    <div className="w-full">
      <PageHeader
        crumbs={[{ label: workspace.name }]}
        media={
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-[19px] font-bold text-primary-bright">
            {workspace.name[0]?.toUpperCase()}
          </span>
        }
        title={workspace.name}
        meta={ownerless && <Badge variant="warning">no owner</Badge>}
        desc={`Created ${formatDate(workspace.createdAt)} · ${lastActive}`}
        action={
          tab !== 'members' &&
          tab !== 'settings' && (
            <Button variant="default" size="lg" onClick={() => onTab('members')}>
              <PlusIcon width={15} height={15} />
              {ownerless ? 'Assign owner' : 'Add member'}
            </Button>
          )
        }
      />
      <PageTabs tabs={WORKSPACE_DETAIL_TABS} active={tab} onTab={onTab}>
        {tab === 'overview' && <OverviewTab overview={overview} onTab={onTab} />}
        {tab === 'members' && <MembersTab workspaceId={id} ownerless={ownerless} onChanged={load} />}
        {tab === 'connections' && <ConnectionsTab workspaceId={id} />}
        {tab === 'resources' && <ResourcesTab workspaceId={id} />}
        {tab === 'activity' && <ActivityTab workspaceId={id} />}
        {tab === 'settings' && <SettingsTab overview={overview} onChanged={load} onDeleted={onBack} />}
      </PageTabs>
    </div>
  )
}
