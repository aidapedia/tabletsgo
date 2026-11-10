import type { ComponentType, SVGProps } from 'react'
import { useNavigate } from 'react-router-dom'
import type { WorkspaceDashboard } from '@/features/dashboard'
import type { WorkspaceWorkflow } from '@/features/workflow'
import type { WorkspaceSchemaDraft } from '@/features/schema-designer'
import { DiagramIcon, GridIcon, WorkflowIcon } from '@/shared/ui/icons'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { relativeTime } from '@/shared/lib/recents'
import HomePanel from './HomePanel'

const SHOWN = 6

type Entry = {
  key: string
  kind: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  name: string
  where: string
  by: string | null
  ts: number
  href: string
}

/**
 * What changed lately, across the three things people build on a connection.
 * Pure merge-and-sort of lists the page already loaded — no activity log of its
 * own, so it only knows each item's last save, not every save.
 */
export function recentActivity(
  workflows: WorkspaceWorkflow[],
  dashboards: WorkspaceDashboard[],
  schemas: WorkspaceSchemaDraft[]
): Entry[] {
  return [
    ...workflows.map((w) => ({
      key: `w:${w.id}`,
      kind: 'Workflow',
      Icon: WorkflowIcon,
      name: w.name,
      where: w.connectionName,
      by: null,
      ts: w.ts,
      href: `/connection/${w.connectionId}?workflow=${w.id}`,
    })),
    ...dashboards.map((d) => ({
      key: `d:${d.id}`,
      kind: 'Dashboard',
      Icon: GridIcon,
      name: d.name,
      where: d.connectionName,
      by: null,
      ts: d.ts,
      href: `/connection/${d.connectionId}?dashboard=${d.id}`,
    })),
    ...schemas.map((s) => ({
      key: `s:${s.id}`,
      kind: 'Schema draft',
      Icon: DiagramIcon,
      name: s.name,
      where: s.connectionName || 'From scratch',
      by: s.updatedByName,
      ts: s.ts,
      href: `/schemas/${s.id}`,
    })),
  ].sort((a, b) => b.ts - a.ts)
}

export default function ActivityPanel({
  workflows,
  dashboards,
  schemas,
  loading,
}: {
  workflows: WorkspaceWorkflow[]
  dashboards: WorkspaceDashboard[]
  schemas: WorkspaceSchemaDraft[]
  loading: boolean
}) {
  const navigate = useNavigate()
  const entries = recentActivity(workflows, dashboards, schemas).slice(0, SHOWN)

  return (
    <HomePanel title="Recently updated">
      {loading ? (
        <LoadingState />
      ) : entries.length === 0 ? (
        <EmptyState>Workflows, dashboards and schema drafts you build will show up here.</EmptyState>
      ) : (
        <ul className="flex flex-col">
          {entries.map(({ key, kind, Icon, name, where, by, ts, href }) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => navigate(href)}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon width={14} height={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium">{name}</span>
                  <span className="block truncate text-[11px] text-faint">
                    {kind} · {where}
                    {by && ` · ${by}`}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(ts)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </HomePanel>
  )
}
