import { useNavigate } from 'react-router-dom'
import type { WorkspaceWorkflow } from '@/features/workflow'
import { AlertIcon, CheckIcon, ClockIcon } from '@/shared/ui/icons'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { formatDateTime } from '@/shared/lib/datetime'
import { relativeTime } from '@/shared/lib/recents'
import HomePanel from './HomePanel'

const SHOWN = 4

/**
 * The two questions about automations worth answering before anyone asks:
 * did something break, and what runs next. A failed last run is listed first
 * because it is the only thing on the home page that asks for action.
 */
export default function AutomationPanel({ workflows, loading }: { workflows: WorkspaceWorkflow[]; loading: boolean }) {
  const navigate = useNavigate()
  // Same address the Workflow section opens — the workflow travels in the URL.
  const open = (w: WorkspaceWorkflow) => navigate(`/connection/${w.connectionId}?workflow=${w.id}`)

  const failing = workflows
    .filter((w) => w.lastRun?.status === 'failed')
    .sort((a, b) => b.lastRun!.at - a.lastRun!.at)
  const upcoming = workflows
    .filter((w) => w.scheduleEnabled && w.nextRunAt)
    .sort((a, b) => a.nextRunAt! - b.nextRunAt!)
    .slice(0, SHOWN)

  return (
    <HomePanel title="Automations" onViewAll={() => navigate('/workflows')}>
      {loading ? (
        <LoadingState />
      ) : workflows.length === 0 ? (
        <EmptyState>No workflows yet.</EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {failing.length > 0 ? (
            <ul className="flex flex-col">
              {failing.slice(0, SHOWN).map((w) => (
                <Row
                  key={w.id}
                  onClick={() => open(w)}
                  icon={
                    <span className="flex size-7 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
                      <AlertIcon width={14} height={14} />
                    </span>
                  }
                  title={w.name}
                  sub={`Failed ${relativeTime(w.lastRun!.at).toLowerCase()} · ${w.connectionName}`}
                />
              ))}
            </ul>
          ) : (
            <div className="mx-1 flex items-center gap-2.5 rounded-lg bg-muted/50 px-2.5 py-2 text-[11px] text-muted-foreground">
              <span className="flex size-5 items-center justify-center rounded-full bg-success/15 text-success">
                <CheckIcon width={11} height={11} />
              </span>
              Every workflow's last run succeeded.
            </div>
          )}

          <div>
            <div className="px-2.5 pb-1 text-[10px] font-semibold tracking-wide text-faint uppercase">Up next</div>
            {upcoming.length === 0 ? (
              <div className="px-2.5 py-1.5 text-[11px] text-faint">Nothing scheduled.</div>
            ) : (
              <ul className="flex flex-col">
                {upcoming.map((w) => (
                  <Row
                    key={w.id}
                    onClick={() => open(w)}
                    icon={
                      <span className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <ClockIcon width={14} height={14} />
                      </span>
                    }
                    title={w.name}
                    sub={w.connectionName}
                    trailing={formatDateTime(w.nextRunAt!)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </HomePanel>
  )
}

function Row({
  icon,
  title,
  sub,
  trailing,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  sub: string
  trailing?: string
  onClick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium">{title}</span>
          <span className="block truncate text-[11px] text-faint">{sub}</span>
        </span>
        {trailing && <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{trailing}</span>}
      </button>
    </li>
  )
}
