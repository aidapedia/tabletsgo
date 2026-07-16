import { useEffect, useState } from 'react'
import Badge from '@/shared/ui/Badge'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import SqlEditor from '@/shared/ui/SqlEditor'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { useToast } from '@/shared/ui/feedback/Toast'
import { analyzeQuery } from '@/shared/api/database'
import { ChevronRight, CodeIcon, CopyIcon } from '@/shared/ui/icons'

// Read-only slide-over showing a query's performance analysis: summary strip
// (measured vs estimated), index suggestions with ready-to-run CREATE INDEX
// DDL, query-level suggestions, and the normalized execution plan. Opened from
// the SQL editor toolbar or a saved query's kebab; owns its own fetch.
export default function AnalyzePanel({ conn, dialect, sql, onClose, onOpenInEditor }) {
  const { show, close } = useSlideOver(onClose)
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)
  const [rawOpen, setRawOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    analyzeQuery(conn, sql)
      .then((r) => { if (!cancelled) setResult(r) })
      .catch((e) => { if (!cancelled) setError((e as Error)?.message || 'Analysis failed') })
      .finally(() => { if (!cancelled) setLoading(false) })
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

  const summary = result?.summary
  const suggestions = result ? result.indexSuggestions.length + result.querySuggestions.length : 0
  const stat = (label, value) => (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="text-sm font-medium text-ink">{value}</div>
    </div>
  )

  return (
    <SlideOverPanel
      show={show}
      close={close}
      width={560}
      title={
        <span className="flex items-center gap-2 truncate">
          Analyze performance
          <span className="shrink-0 rounded border border-edge bg-elevated px-1.5 py-0.5 text-[10px] font-semibold text-ink-dim">
            {dialect}
          </span>
        </span>
      }
      footer={
        <Button variant="subtle" onClick={() => close()}>
          Close
        </Button>
      }
    >
      {loading && <LoadingState className="py-10 text-center" />}

          {error && (
            <div className="rounded-soft border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">{error}</div>
          )}

          {result && (
            <>
              {/* ---- The analyzed query ---- */}
              <div className="mb-5">
                <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-faint">Query</div>
                <SqlEditor value={sql} onChange={() => {}} dialect={conn?.type} editable={false} maxHeight="120px" />
              </div>

              {/* ---- Summary strip ---- */}
              <div className="mb-5 flex items-center gap-5 rounded-soft border border-edge bg-bg px-4 py-3">
                <Badge tone={summary.mode === 'actual' ? 'green' : 'amber'} dense>
                  {summary.mode === 'actual' ? 'measured' : 'estimated'}
                </Badge>
                {summary.elapsedMs != null && stat('Time', `${summary.elapsedMs} ms`)}
                {summary.rowsReturned != null && stat('Rows', summary.rowsReturned)}
                {summary.estimatedCost != null && stat('Est. cost', summary.estimatedCost)}
              </div>

              {suggestions === 0 && (
                <EmptyState className="py-8">No issues found — this query looks efficient.</EmptyState>
              )}

              {/* ---- Index suggestions ---- */}
              {result.indexSuggestions.length > 0 && (
                <div className="mb-5">
                  <div className="mb-2 text-[11px] font-semibold tracking-wide text-ink-faint">
                    Recommended indexes
                  </div>
                  <div className="flex flex-col gap-3">
                    {result.indexSuggestions.map((s, i) => (
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

              {/* ---- Query-level suggestions ---- */}
              {result.querySuggestions.length > 0 && (
                <div className="mb-5">
                  <div className="mb-2 text-[11px] font-semibold tracking-wide text-ink-faint">
                    Query suggestions
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {result.querySuggestions.map((q) => (
                      <li key={q.code} className="flex items-start gap-2 text-xs text-ink-dim">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber" />
                        {q.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* ---- Normalized plan ---- */}
              {result.plan.length > 0 && (
                <div className="mb-5">
                  <div className="mb-2 text-[11px] font-semibold tracking-wide text-ink-faint">Execution plan</div>
                  <div className="flex flex-col gap-0.5 rounded-soft border border-edge bg-bg p-2">
                    {result.plan.map((p, i) => (
                      <div key={i} style={{ paddingLeft: p.depth * 14 }} className="flex items-baseline gap-2 py-0.5">
                        <span className={`shrink-0 font-mono text-[10px] font-semibold ${p.warning ? 'text-amber' : 'text-ink-faint'}`}>
                          {p.step}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-dim" title={p.detail}>
                          {p.detail}
                        </span>
                        {p.rows != null && <span className="shrink-0 text-[10px] text-ink-faint">{p.rows} rows</span>}
                        {p.warning && <Badge tone="amber" dense>{p.warning}</Badge>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ---- Raw dialect-native plan ---- */}
              <div>
                <TextButton tone="faint" className="!text-[11px] hover:!text-ink" onClick={() => setRawOpen((v) => !v)}>
                  <ChevronRight width={12} height={12} className={`transition-transform ${rawOpen ? 'rotate-90' : ''}`} />
                  Raw plan
                </TextButton>
                {rawOpen && (
                  <pre className="mt-2 max-h-[240px] overflow-auto rounded-soft border border-edge bg-bg p-3 font-mono text-[11px] text-ink-dim">
                    {result.rawPlan.rows
                      .map((r) => Object.values(r).join(' | '))
                      .join('\n')}
                  </pre>
                )}
              </div>
            </>
          )}
    </SlideOverPanel>
  )
}
