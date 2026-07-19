import { useEffect, useState } from 'react'
import { CloseIcon } from '@/shared/ui/icons'
import IconButton from '@/shared/ui/buttons/IconButton'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import { listWorkflowRuns } from '@/features/workflow/lib/api'
import type { TriggerKind, WorkflowRunSummary } from '@/features/workflow/lib/api'

// Human labels + accent for each trigger kind, shown as a pill per run.
const TRIGGER_LABEL: Record<TriggerKind, string> = {
  manual: 'Manual',
  dashboard: 'Dashboard',
  schedule: 'Schedule',
  webhook: 'Webhook',
}

const fmtWhen = (ms: number) => {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ms).toLocaleString()
}

// Bottom drawer listing this workflow's run history (all triggers). Clicking a
// run opens its stored per-node log in the run-log drawer. `reloadToken` changes
// after each manual run so the list refreshes without a manual reload.
export default function ActivityPanel({
  connectionId,
  workflowId,
  reloadToken,
  onSelect,
  onClose,
}: {
  connectionId: string
  workflowId: string
  reloadToken: unknown
  onSelect: (runId: string) => void
  onClose: () => void
}) {
  const [runs, setRuns] = useState<WorkflowRunSummary[] | null>(null)

  useEffect(() => {
    let alive = true
    listWorkflowRuns(connectionId, workflowId).then((list) => alive && setRuns(list))
    return () => {
      alive = false
    }
  }, [connectionId, workflowId, reloadToken])

  return (
    <div className="flex h-[240px] shrink-0 flex-col border-t border-edge bg-panel">
      <div className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-2">
        <span className="text-xs font-semibold">Activity</span>
        <IconButton className="!rounded" onClick={onClose} aria-label="Close activity">
          <CloseIcon width={14} height={14} />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {runs === null ? (
          <LoadingState />
        ) : runs.length === 0 ? (
          <EmptyState>No runs yet — run this workflow to see its history.</EmptyState>
        ) : (
          <div className="flex flex-col gap-1.5">
            {runs.map((r) => (
              <button
                key={r.id}
                onClick={() => onSelect(r.id)}
                className="flex items-center gap-2.5 rounded-soft border border-edge bg-elevated/40 px-3 py-2 text-left hover:border-edge-strong"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${r.status === 'success' ? 'bg-green' : 'bg-red'}`} />
                <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-dim">
                  {TRIGGER_LABEL[r.triggerKind] || r.triggerKind}
                </span>
                <span className={`text-[11px] font-medium ${r.status === 'success' ? 'text-ink' : 'text-red'}`}>
                  {r.status === 'success' ? 'Success' : 'Failed'}
                </span>
                {r.error && <span className="min-w-0 flex-1 truncate text-[11px] text-ink-faint">{r.error}</span>}
                <span className="ml-auto shrink-0 text-[10px] text-ink-faint">
                  {r.ms != null ? `${r.ms}ms · ` : ''}
                  {fmtWhen(r.startedAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
