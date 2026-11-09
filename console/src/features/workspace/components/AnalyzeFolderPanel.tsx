import { useEffect, useState } from 'react'
import SqlEditor from '@/shared/ui/SqlEditor'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { toast } from 'sonner'
import { analyzeQuery } from '@/shared/api/database'
import { ChevronRight, CodeIcon, CopyIcon } from '@/shared/ui/icons'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Switch } from '@/shared/ui/switch'

// Read-only slide-over that runs the performance analysis for every query in a
// saved-queries folder (and its subfolders) and lists the results, each query
// collapsible to its full breakdown. Opened from a folder's kebab; owns the
// batch fetch. Reuses the same /analyze endpoint as the single-query panel.
export default function AnalyzeFolderPanel({ conn, dialect, folderName, queries = [], onClose, onOpenInEditor }) {
  const { show, close } = useSlideOver(onClose)
  const [loading, setLoading] = useState(queries.length > 0)
  // Per-query outcome, keyed by query id: { status, result?, error? }
  const [results, setResults] = useState<Record<string, any>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [onlyIssues, setOnlyIssues] = useState(true) // hide queries with no recommendation

  useEffect(() => {
    if (queries.length === 0) return
    let cancelled = false
    Promise.all(
      queries.map((qy) =>
        analyzeQuery(conn, qy.sql)
          .then((r) => ({ id: qy.id, status: 'ok', result: r }))
          .catch((e) => ({ id: qy.id, status: 'error', error: (e as Error)?.message || 'Analysis failed' })),
      ),
    ).then((outcomes) => {
      if (cancelled) return
      setResults(Object.fromEntries(outcomes.map((o) => [o.id, o])))
      setLoading(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const copyDdl = async (ddl) => {
    try {
      await navigator.clipboard.writeText(ddl)
      toast.success('Copied CREATE INDEX')
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  const toggle = (id) =>
    setExpanded((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const suggestionCount = (r) => (r ? r.indexSuggestions.length + r.querySuggestions.length : 0)
  const totalSuggestions = queries.reduce((n, qy) => n + suggestionCount(results[qy.id]?.result), 0)
  const failedCount = queries.filter((qy) => results[qy.id]?.status === 'error').length
  // A query is worth showing if it failed or produced at least one recommendation.
  const hasIssues = (qy) => {
    const o = results[qy.id]
    return o?.status === 'error' || suggestionCount(o?.result) > 0
  }
  const efficientCount = queries.filter((qy) => results[qy.id]?.status === 'ok' && !hasIssues(qy)).length
  const visibleQueries = onlyIssues ? queries.filter(hasIssues) : queries

  const renderResult = (r) => {
    const summary = r.summary
    return (
      <>
        {/* Summary strip */}
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-background px-4 py-3">
          <Badge variant={summary.mode === 'actual' ? 'default' : 'warning'} size="dense">
            {summary.mode === 'actual' ? 'measured' : 'estimated'}
          </Badge>
          {summary.elapsedMs != null && stat('Time', `${summary.elapsedMs} ms`)}
          {summary.rowsReturned != null && stat('Rows', summary.rowsReturned)}
          {summary.estimatedCost != null && stat('Est. cost', summary.estimatedCost)}
        </div>

        {suggestionCount(r) === 0 && (
          <EmptyState className="py-6">No issues found — this query looks efficient.</EmptyState>
        )}

        {/* Index suggestions */}
        {r.indexSuggestions.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-faint">Recommended indexes</div>
            <div className="flex flex-col gap-3">
              {r.indexSuggestions.map((s, i) => (
                <div key={i} className="rounded-lg border border-border bg-background p-3">
                  <div className="mb-2 text-xs text-muted-foreground">{s.reason}</div>
                  <SqlEditor value={s.ddl} onChange={() => {}} dialect={conn?.type} editable={false} maxHeight="80px" />
                  <div className="mt-2 flex items-center gap-3">
                    <Button variant="link" size="inline" type="button" className="text-faint hover:text-foreground !text-[11px] hover:!text-foreground" onClick={() => copyDdl(s.ddl)}>
                      <CopyIcon width={13} height={13} /> Copy
                    </Button>
                    <Button variant="link" size="inline" type="button"
                      className="text-faint hover:text-foreground !text-[11px] hover:!text-foreground"
                      onClick={() => close(() => onOpenInEditor?.(s.ddl))}
                    >
                      <CodeIcon width={13} height={13} /> Open in SQL Editor
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Query-level suggestions */}
        {r.querySuggestions.length > 0 && (
          <div className="mb-1">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-faint">Query suggestions</div>
            <ul className="flex flex-col gap-1.5">
              {r.querySuggestions.map((q) => (
                <li key={q.code} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-warning" />
                  {q.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    )
  }

  return (
    <SlideOverPanel
      show={show}
      close={close}
      width={560}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">Analyze “{folderName}”</span>
          <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            {dialect}
          </span>
        </span>
      }
      footer={
        <Button variant="ghost" onClick={() => close()}>
          Close
        </Button>
      }
    >
      {queries.length === 0 ? (
            <EmptyState className="py-10">No queries in this folder to analyze.</EmptyState>
          ) : (
            <>
              {/* Overall summary */}
              <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-background px-4 py-3">
                {stat('Queries', queries.length)}
                {stat('Suggestions', loading ? '…' : totalSuggestions)}
                {failedCount > 0 && stat('Failed', failedCount)}
                {!loading && (
                  <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    Only with recommendations
                    <Switch checked={onlyIssues} onCheckedChange={(checked) => setOnlyIssues(checked === true)} aria-label="Only show queries with recommendations" />
                  </label>
                )}
              </div>

              {loading && <LoadingState className="py-8 text-center" />}

              {!loading && visibleQueries.length === 0 && (
                <EmptyState className="py-10">
                  {onlyIssues && efficientCount > 0
                    ? `All ${efficientCount} quer${efficientCount === 1 ? 'y looks' : 'ies look'} efficient — no recommendations.`
                    : 'Nothing to show.'}
                </EmptyState>
              )}

              {!loading && visibleQueries.length > 0 && (
                <div className="flex flex-col gap-2">
                  {onlyIssues && efficientCount > 0 && (
                    <div className="px-1 text-[11px] text-faint">
                      {efficientCount} efficient quer{efficientCount === 1 ? 'y' : 'ies'} hidden.
                    </div>
                  )}
                  {visibleQueries.map((qy) => {
                    const o = results[qy.id]
                    const isOpen = expanded.has(qy.id)
                    const n = suggestionCount(o?.result)
                    return (
                      <div key={qy.id} className="rounded-lg border border-border bg-background">
                        <button
                          onClick={() => toggle(qy.id)}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                        >
                          <ChevronRight
                            width={13}
                            height={13}
                            className={`shrink-0 text-faint transition-transform ${isOpen ? 'rotate-90' : ''}`}
                          />
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{qy.name}</span>
                          {o?.status === 'error' ? (
                            <Badge variant="destructive" size="dense">failed</Badge>
                          ) : n > 0 ? (
                            <Badge variant="warning" size="dense">{n} suggestion{n === 1 ? '' : 's'}</Badge>
                          ) : (
                            <Badge variant="default" size="dense">ok</Badge>
                          )}
                        </button>

                        {isOpen && (
                          <div className="border-t border-border px-3 py-3">
                            <div className="mb-3">
                              <SqlEditor value={qy.sql} onChange={() => {}} dialect={conn?.type} editable={false} maxHeight="100px" />
                            </div>
                            {o?.status === 'error' ? (
                              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                {o.error}
                              </div>
                            ) : (
                              o?.result && renderResult(o.result)
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
    </SlideOverPanel>
  )
}

const stat = (label, value) => (
  <div>
    <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</div>
    <div className="text-sm font-medium text-foreground">{value}</div>
  </div>
)
