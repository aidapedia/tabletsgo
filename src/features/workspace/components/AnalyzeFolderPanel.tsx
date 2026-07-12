import { useEffect, useState } from 'react'
import Badge from '@/shared/ui/Badge'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import TextButton from '@/shared/ui/buttons/TextButton'
import SqlEditor from '@/shared/ui/SqlEditor'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import Toggle from '@/shared/ui/form/Toggle'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { useToast } from '@/shared/ui/feedback/Toast'
import { analyzeQuery } from '@/shared/api/database'
import { ChevronRight, CodeIcon, CopyIcon } from '@/shared/ui/icons'

// Read-only slide-over that runs the performance analysis for every query in a
// saved-queries folder (and its subfolders) and lists the results, each query
// collapsible to its full breakdown. Opened from a folder's kebab; owns the
// batch fetch. Reuses the same /analyze endpoint as the single-query panel.
export default function AnalyzeFolderPanel({ conn, dialect, folderName, queries = [], onClose, onOpenInEditor }) {
  const { show, close } = useSlideOver(onClose)
  const toast = useToast()
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
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-soft border border-edge bg-bg px-4 py-3">
          <Badge tone={summary.mode === 'actual' ? 'green' : 'amber'} dense>
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
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-ink-faint">Recommended indexes</div>
            <div className="flex flex-col gap-3">
              {r.indexSuggestions.map((s, i) => (
                <div key={i} className="rounded-soft border border-edge bg-bg p-3">
                  <div className="mb-2 text-xs text-ink-dim">{s.reason}</div>
                  <SqlEditor value={s.ddl} onChange={() => {}} dialect={conn?.type} editable={false} maxHeight="80px" />
                  <div className="mt-2 flex items-center gap-3">
                    <TextButton tone="faint" className="!text-[11px] hover:!text-ink" onClick={() => copyDdl(s.ddl)}>
                      <CopyIcon width={13} height={13} /> Copy
                    </TextButton>
                    <TextButton
                      tone="faint"
                      className="!text-[11px] hover:!text-ink"
                      onClick={() => close(() => onOpenInEditor?.(s.ddl))}
                    >
                      <CodeIcon width={13} height={13} /> Open in SQL Editor
                    </TextButton>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Query-level suggestions */}
        {r.querySuggestions.length > 0 && (
          <div className="mb-1">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-ink-faint">Query suggestions</div>
            <ul className="flex flex-col gap-1.5">
              {r.querySuggestions.map((q) => (
                <li key={q.code} className="flex items-start gap-2 text-xs text-ink-dim">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber" />
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
    <div
      className={`fixed inset-0 z-50 flex justify-end bg-black/50 transition-opacity duration-200 ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseDown={() => close()}
    >
      <div
        className={`flex h-full w-full max-w-[560px] flex-col border-l border-edge-strong bg-panel shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.8)] transition-transform duration-200 ease-out ${
          show ? 'translate-x-0' : 'translate-x-full'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <h3 className="flex min-w-0 items-center gap-2 text-base font-bold">
            <span className="truncate">Analyze “{folderName}”</span>
            <span className="shrink-0 rounded border border-edge bg-elevated px-1.5 py-0.5 text-[10px] font-semibold text-ink-dim">
              {dialect}
            </span>
          </h3>
          <IconButton size="lg" onClick={() => close()} aria-label="Close">
            <ChevronRight />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {queries.length === 0 ? (
            <EmptyState className="py-10">No queries in this folder to analyze.</EmptyState>
          ) : (
            <>
              {/* Overall summary */}
              <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-soft border border-edge bg-bg px-4 py-3">
                {stat('Queries', queries.length)}
                {stat('Suggestions', loading ? '…' : totalSuggestions)}
                {failedCount > 0 && stat('Failed', failedCount)}
                {!loading && (
                  <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-ink-dim">
                    Only with recommendations
                    <Toggle checked={onlyIssues} onChange={setOnlyIssues} ariaLabel="Only show queries with recommendations" />
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
                    <div className="px-1 text-[11px] text-ink-faint">
                      {efficientCount} efficient quer{efficientCount === 1 ? 'y' : 'ies'} hidden.
                    </div>
                  )}
                  {visibleQueries.map((qy) => {
                    const o = results[qy.id]
                    const isOpen = expanded.has(qy.id)
                    const n = suggestionCount(o?.result)
                    return (
                      <div key={qy.id} className="rounded-soft border border-edge bg-bg">
                        <button
                          onClick={() => toggle(qy.id)}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                        >
                          <ChevronRight
                            width={13}
                            height={13}
                            className={`shrink-0 text-ink-faint transition-transform ${isOpen ? 'rotate-90' : ''}`}
                          />
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{qy.name}</span>
                          {o?.status === 'error' ? (
                            <Badge tone="red" dense>failed</Badge>
                          ) : n > 0 ? (
                            <Badge tone="amber" dense>{n} suggestion{n === 1 ? '' : 's'}</Badge>
                          ) : (
                            <Badge tone="green" dense>ok</Badge>
                          )}
                        </button>

                        {isOpen && (
                          <div className="border-t border-edge px-3 py-3">
                            <div className="mb-3">
                              <SqlEditor value={qy.sql} onChange={() => {}} dialect={conn?.type} editable={false} maxHeight="100px" />
                            </div>
                            {o?.status === 'error' ? (
                              <div className="rounded-soft border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">
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
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-edge px-5 py-4">
          <Button variant="subtle" onClick={() => close()}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}

const stat = (label, value) => (
  <div>
    <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</div>
    <div className="text-sm font-medium text-ink">{value}</div>
  </div>
)
