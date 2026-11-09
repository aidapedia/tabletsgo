import { CloseIcon } from '@/shared/ui/icons'
import { NODE_SPECS } from '@/features/workflow/lib/nodeSpec'
import type { RunResult } from '@/features/workflow/lib/api'
import { Button } from '@/shared/ui/button'

const fmt = (v: unknown) => {
  if (v === undefined) return '—'
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

// Bottom drawer listing the last run: per-node status/timing/output plus the
// overall result or the error that halted execution.
export default function RunLogPanel({
  result,
  running,
  labelFor,
  onClose,
}: {
  result: RunResult | null
  running: boolean
  labelFor: (nodeId: string) => string
  onClose: () => void
}) {
  return (
    <div className="flex h-[240px] shrink-0 flex-col border-t border-border bg-sidebar">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold">Run log</span>
          {running ? (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
              Running…
            </span>
          ) : result ? (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                result.ok ? 'bg-primary/15 text-primary-bright' : 'bg-destructive/15 text-destructive'
              }`}
            >
              {result.ok ? 'Success' : 'Failed'}
            </span>
          ) : null}
        </div>
        <Button variant="ghost" size="icon-sm" className="!rounded" onClick={onClose} aria-label="Close run log">
          <CloseIcon width={14} height={14} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {!result && !running && <div className="text-[11px] text-faint">Run the workflow to see per-node results.</div>}

        {result?.error && (
          <div className="mb-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-[11px] text-[#ff9b9b]">
            {result.error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          {(result?.log || []).map((entry, i) => {
            const spec = NODE_SPECS[entry.nodeType as keyof typeof NODE_SPECS]
            const Icon = spec?.icon
            return (
              <div key={i} className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  {Icon && (
                    <span className={`flex h-5 w-5 items-center justify-center rounded bg-muted ${spec.accent}`}>
                      <Icon width={12} height={12} />
                    </span>
                  )}
                  <span className="text-[12px] font-medium text-foreground">{labelFor(entry.nodeId)}</span>
                  <span
                    className={`ml-1 h-1.5 w-1.5 rounded-full ${entry.status === 'error' ? 'bg-destructive' : 'bg-primary'}`}
                  />
                  <span className="ml-auto text-[10px] text-faint">{entry.ms}ms</span>
                </div>

                {entry.error && <div className="mt-1.5 font-mono text-[11px] text-[#ff9b9b]">{entry.error}</div>}

                {entry.logs?.length ? (
                  <pre className="mt-1.5 whitespace-pre-wrap rounded bg-background/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                    {entry.logs.join('\n')}
                  </pre>
                ) : null}

                {entry.output !== undefined && entry.status !== 'error' && (
                  <pre className="mt-1.5 max-h-[120px] overflow-auto whitespace-pre-wrap rounded bg-background/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                    {fmt(entry.output)}
                  </pre>
                )}
              </div>
            )
          })}
        </div>

        {result?.ok && result.output !== undefined && (
          <div className="mt-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Final output</div>
            <pre className="max-h-[120px] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background/60 px-3 py-2 font-mono text-[10px] text-muted-foreground">
              {fmt(result.output)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
