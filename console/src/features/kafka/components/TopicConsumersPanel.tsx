import { useCallback, useEffect, useState } from 'react'
import RefreshButton from '@/shared/ui/RefreshButton'
import { listGroups, type GroupSummary } from '../lib/api'
import { compact, groupStateLook, lagTone } from '../lib/format'
import { Badge } from '@/shared/ui/badge'
import Pagination from '@/shared/ui/table/Pagination'
import usePagination from '@/shared/ui/table/usePagination'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

/** The consumer groups reading this topic — committed to it or assigned it — and their lag on it. */
export default function TopicConsumersPanel({ conn, topic, onOpenGroup }: { conn: any; topic: string; onOpenGroup: (group: string) => void }) {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { pageRows, pager } = usePagination(groups ?? [], { resetKey: topic })

  const load = useCallback(
    () =>
      listGroups(conn)
        .then((all) => {
          setGroups(all.filter((g) => g.topics.includes(topic)))
          setError(null)
        })
        .catch((e) => setError(e.message)),
    [conn, topic]
  )

  useEffect(() => {
    load()
  }, [load])

  if (error) return <div className="mx-[18px] my-4 rounded-[9px] border border-destructive/25 bg-destructive/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">{error}</div>
  if (!groups) return <div className="p-[30px] text-center text-xs text-faint">Reading consumer groups…</div>

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">
      <div className="mb-3 flex items-center gap-3">
        <span className="text-[11px] text-faint">
          {groups.length} group{groups.length === 1 ? '' : 's'} reading {topic}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex ml-auto">
              <RefreshButton size="icon-xs" iconSize={13} aria-label="Refresh consumer groups" onRefresh={load} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">Refresh</TooltipContent>
        </Tooltip>
      </div>
      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-input p-8 text-center text-xs text-faint">No consumer group has committed offsets on {topic}.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-sidebar">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-[11px] text-faint">
                <th className="h-8 border-b border-border px-3.5 font-semibold">Group</th>
                <th className="h-8 border-b border-border px-3.5 font-semibold">State</th>
                <th className="h-8 border-b border-border px-3.5 text-right font-semibold">Members</th>
                <th className="h-8 border-b border-border px-3.5 text-right font-semibold">Lag</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((g) => {
                const look = groupStateLook(g.state)
                const lag = g.lagByTopic?.[topic] ?? 0
                return (
                  <tr key={g.id} onClick={() => onOpenGroup(g.id)} className="cursor-pointer hover:bg-muted">
                    <td className="h-[34px] border-b border-border/60 px-3.5 font-mono">{g.id}</td>
                    <td className="border-b border-border/60 px-3.5">
                      <Badge variant={look.tone}>{look.label}</Badge>
                    </td>
                    <td className="border-b border-border/60 px-3.5 text-right">{g.members}</td>
                    <td className={`border-b border-border/60 px-3.5 text-right font-mono ${lagTone(lag)}`}>{compact(lag)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <Pagination className="px-3 py-1.5 text-[11px]" {...pager} />
          <p className="border-t border-border px-3.5 py-2 text-[11px] text-faint">Lag on {topic} only. Open a group for the per-partition picture across everything it reads.</p>
        </div>
      )}
    </div>
  )
}
