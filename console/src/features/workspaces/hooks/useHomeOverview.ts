import { useEffect, useState } from 'react'
import { listWorkspaceDashboards, type WorkspaceDashboard } from '@/features/dashboard'
import { listWorkspaceWorkflows, type WorkspaceWorkflow } from '@/features/workflow'
import { listWorkspaceSchemas, type WorkspaceSchemaDraft } from '@/features/schema-designer'
import { listMembers } from '../api'

export type HomeOverview = {
  workflows: WorkspaceWorkflow[]
  dashboards: WorkspaceDashboard[]
  schemas: WorkspaceSchemaDraft[]
  memberCount: number | null
  loading: boolean
}

const EMPTY: HomeOverview = { workflows: [], dashboards: [], schemas: [], memberCount: null, loading: true }

/**
 * Everything the home page summarises, in one round of parallel reads.
 *
 * Each list is the same workspace-wide endpoint its own section uses, so the
 * home page can never show more than the caller could reach there — the server
 * already filtered every row by connection access. Reads degrade quietly: a
 * failed one is an empty list, and the rest of the page still renders.
 */
export function useHomeOverview(workspaceId: string | undefined): HomeOverview {
  const [state, setState] = useState<HomeOverview>(EMPTY)

  useEffect(() => {
    if (!workspaceId) return
    let alive = true
    setState(EMPTY)
    Promise.all([
      listWorkspaceWorkflows(workspaceId),
      listWorkspaceDashboards(workspaceId),
      listWorkspaceSchemas(workspaceId),
      listMembers(workspaceId),
    ]).then(([workflows, dashboards, schemas, members]) => {
      if (!alive) return
      setState({
        workflows,
        dashboards,
        schemas,
        memberCount: Array.isArray(members) ? members.length : 0,
        loading: false,
      })
    })
    return () => {
      alive = false
    }
  }, [workspaceId])

  return state
}
