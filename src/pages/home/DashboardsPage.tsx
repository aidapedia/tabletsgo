import { useNavigate } from 'react-router-dom'
import { useWorkspaces } from '@/features/workspaces'
import { WorkspaceDashboardList, type WorkspaceDashboard } from '@/features/dashboard'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { PageHeader } from './ui'

// Dashboard — every query dashboard in the current workspace, across its
// connections. Building and reading one still belongs to the console (that is
// where the widgets and their database are); this section is the overview the
// console can't give. Same shape as the Workflow section next to it.
export default function DashboardsPage() {
  const { current } = useWorkspaces()
  const navigate = useNavigate()

  // The console opens tabs from its own rail, so the dashboard to open travels
  // in the URL — that also makes a row here a link you can paste.
  const open = (dashboard: WorkspaceDashboard) =>
    navigate(`/connection/${dashboard.connectionId}?dashboard=${dashboard.id}`)

  return (
    <div className="w-full">
      <PageHeader
        title="Dashboard"
        desc="Every dashboard in this workspace — which connection it reads, and how big it is."
      />

      <div className="mt-6">
        {current ? <WorkspaceDashboardList workspaceId={current.id} onOpen={open} /> : <LoadingState className="" />}
      </div>
    </div>
  )
}
