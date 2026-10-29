import { useEffect, useState } from 'react'
import Badge from '@/shared/ui/Badge'
import { listGroups, type GroupSummary } from '../lib/api'
import { compact, groupStateLook, lagTone } from '../lib/format'

/** The consumer groups reading this topic — committed to it or assigned it. */
export default function TopicConsumersPanel({ conn, topic, onOpenGroup }: { conn: any; topic: string; onOpenGroup: (group: string) => void }) {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listGroups(conn)
      .then((all) => setGroups(all.filter((g) => g.topics.includes(topic))))
      .catch((e) => setError(e.message))
  }, [conn, topic])

  if (error) return <div className="mx-[18px] my-4 rounded-[9px] border border-red/25 bg-red/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">{error}</div>
  if (!groups) return <div className="p-[30px] text-center text-xs text-ink-faint">Reading consumer groups…</div>

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">
      {groups.length === 0 ? (
        <div className="rounded-card border border-dashed border-edge-strong p-8 text-center text-xs text-ink-faint">No consumer group has committed offsets on {topic}.</div>
      ) : (
        <div className="overflow-hidden rounded-card border border-edge bg-panel">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-[11px] text-ink-faint">
                <th className="h-8 border-b border-edge px-3.5 font-semibold">Group</th>
                <th className="h-8 border-b border-edge px-3.5 font-semibold">State</th>
                <th className="h-8 border-b border-edge px-3.5 text-right font-semibold">Members</th>
                <th className="h-8 border-b border-edge px-3.5 text-right font-semibold">Total lag</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const look = groupStateLook(g.state)
                return (
                  <tr key={g.id} onClick={() => onOpenGroup(g.id)} className="cursor-pointer hover:bg-elevated">
                    <td className="h-[34px] border-b border-edge/60 px-3.5 font-mono">{g.id}</td>
                    <td className="border-b border-edge/60 px-3.5">
                      <Badge tone={look.tone}>{look.label}</Badge>
                    </td>
                    <td className="border-b border-edge/60 px-3.5 text-right">{g.members}</td>
                    <td className={`border-b border-edge/60 px-3.5 text-right font-mono ${lagTone(g.lag)}`}>{compact(g.lag)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="border-t border-edge px-3.5 py-2 text-[11px] text-ink-faint">Lag is across every topic the group reads. Open a group for the per-partition picture.</p>
        </div>
      )}
    </div>
  )
}
