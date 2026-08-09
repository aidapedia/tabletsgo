import { useNavigate } from 'react-router-dom'
import { useWorkspaces } from '@/features/workspaces'
import { WorkspaceWorkflowList, type WorkspaceWorkflow } from '@/features/workflow'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { PageHeader } from './ui'

// Workflow — every automation in the current workspace, across its connections.
// Building and running one still belongs to the console (that is where the graph
// and its database are); this section is the overview the console can't give.
export default function WorkflowsPage() {
  const { current } = useWorkspaces()
  const navigate = useNavigate()

  // The console opens tabs from its own rail, so the workflow to open travels in
  // the URL — that also makes a row here a link you can paste.
  const open = (workflow: WorkspaceWorkflow) =>
    navigate(`/connection/${workflow.connectionId}?workflow=${workflow.id}`)

  return (
    <div className="w-full">
      <PageHeader
        title="Workflow"
        desc="Every workflow in this workspace — what is scheduled, and how it last ran."
      />

      <div className="mt-6">
        {current ? <WorkspaceWorkflowList workspaceId={current.id} onOpen={open} /> : <LoadingState className="" />}
      </div>
    </div>
  )
}
