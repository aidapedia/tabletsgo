import { useCallback, useEffect, useMemo, useState } from 'react'
import RefreshButton from '@/shared/ui/RefreshButton'
import { toast } from 'sonner'
import { deleteGroup, describeGroup, type GroupDetail } from '../lib/api'
import { compact, groupStateLook, lagTone, num } from '../lib/format'
import ResetOffsetsDialog from './ResetOffsetsDialog'
import Pagination from '@/shared/ui/table/Pagination'
import usePagination from '@/shared/ui/table/usePagination'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

/**
 * One consumer group: its state, members and per-partition lag, with the two
 * things you do to a group — reset its offsets, or delete it. Both need the
 * group to be empty; the buttons say so instead of letting the broker refuse.
 */
export default function GroupView({
  conn,
  group,
  onOpenTopic,
  onDeleted,
}: {
  conn: any
  group: string
  onOpenTopic: (topic: string) => void
  onDeleted: (group: string) => void
}) {
  const [detail, setDetail] = useState<GroupDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { pageRows, pager } = usePagination(detail?.offsets ?? [], { resetKey: group })

  const load = useCallback(
    () =>
      describeGroup(conn, group)
        .then((d) => {
          setDetail(d)
          setError(null)
        })
        .catch((e) => setError(e.message)),
    [conn, group]
  )

  useEffect(() => {
    load()
  }, [load])

  const topics = useMemo(() => [...new Set((detail?.offsets || []).map((o) => o.topic))], [detail])
  const maxLag = Math.max(1, ...(detail?.offsets || []).map((o) => o.lag || 0))

  const remove = async () => {
    setDeleting(false)
    try {
      await deleteGroup(conn, group)
      toast.success(`Deleted group ${group}.`)
      onDeleted(group)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  if (error && !detail) {
    return <div className="mx-[18px] my-4 rounded-[9px] border border-destructive/25 bg-destructive/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">{error}</div>
  }
  if (!detail) return <div className="p-[30px] text-center text-xs text-faint">Reading {group}…</div>

  const look = groupStateLook(detail.state)
  const active = detail.members.length > 0
  const busy = active ? `Stop its ${detail.members.length} consumer${detail.members.length === 1 ? '' : 's'} first — Kafka only changes an empty group.` : ''

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-[18px] py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-mono text-[15px] font-bold">{group}</h2>
            <Badge variant={look.tone}>{look.label}</Badge>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {detail.members.length} member{detail.members.length === 1 ? '' : 's'} · {topics.length} topic{topics.length === 1 ? '' : 's'}
            {detail.protocol && ` · ${detail.protocol}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button variant="outline" size="sm" onClick={() => setResetting(true)} disabled={!topics.length}>
                  Reset offsets
                </Button>
              </span>
            </TooltipTrigger>
            {(busy || 'Move the group to another position') && <TooltipContent side="bottom">{busy || 'Move the group to another position'}</TooltipContent>}
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button variant="destructive" size="sm" onClick={() => setDeleting(true)} disabled={active}>
                  Delete group
                </Button>
              </span>
            </TooltipTrigger>
            {(busy || 'Delete the group and its committed offsets') && <TooltipContent side="bottom">{busy || 'Delete the group and its committed offsets'}</TooltipContent>}
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <RefreshButton size="icon-lg" iconSize={15} aria-label="Refresh group" onRefresh={load} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="left">Refresh</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="px-[18px] py-4">
        <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <div className={`rounded-xl border px-4 py-3 ${detail.lag >= 10000 ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-sidebar'}`}>
            <p className={`text-[10px] font-semibold uppercase tracking-wide ${detail.lag >= 10000 ? 'text-destructive' : 'text-faint'}`}>Total lag</p>
            <p className="mt-1 text-xl font-bold">{num(detail.lag)}</p>
          </div>
          <div className="rounded-xl border border-border bg-sidebar px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">Partitions</p>
            <p className="mt-1 text-xl font-bold">{detail.offsets.length}</p>
          </div>
          <div className="rounded-xl border border-border bg-sidebar px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">Members</p>
            <p className="mt-1 text-xl font-bold">{detail.members.length}</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-sidebar">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-[11px] text-faint">
                <th className="h-8 border-b border-border px-3 font-semibold">Topic</th>
                <th className="h-8 border-b border-border px-3 text-right font-semibold">Partition</th>
                <th className="h-8 border-b border-border px-3 text-right font-semibold">Committed</th>
                <th className="h-8 border-b border-border px-3 text-right font-semibold">Log end</th>
                <th className="h-8 border-b border-border px-3 text-right font-semibold">Lag</th>
                <th className="h-8 w-[140px] border-b border-border px-3" />
                <th className="h-8 border-b border-border px-3 font-semibold">Member</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((o) => (
                <tr key={`${o.topic}:${o.partition}`}>
                  <td className="h-[30px] border-b border-border/60 px-3">
                    <button type="button" className="font-mono hover:text-primary" onClick={() => onOpenTopic(o.topic)}>
                      {o.topic}
                    </button>
                  </td>
                  <td className="border-b border-border/60 px-3 text-right font-mono">{o.partition}</td>
                  <td className="border-b border-border/60 px-3 text-right font-mono tabular-nums">{o.committed < 0 ? '–' : num(o.committed)}</td>
                  <td className="border-b border-border/60 px-3 text-right font-mono tabular-nums">{num(o.end)}</td>
                  <td className={`border-b border-border/60 px-3 text-right font-mono tabular-nums ${lagTone(o.lag)}`}>{compact(o.lag)}</td>
                  <td className="border-b border-border/60 px-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${(o.lag || 0) >= 100 ? 'bg-warning' : 'bg-primary'}`}
                        style={{ width: `${Math.max(o.lag ? 2 : 0, Math.round(((o.lag || 0) / maxLag) * 100))}%` }}
                      />
                    </div>
                  </td>
                  <td className="border-b border-border/60 px-3 font-mono text-muted-foreground">{o.member ? `${o.member}${o.host ? ` · ${o.host.replace(/^\//, '')}` : ''}` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {detail.offsets.length ? <Pagination className="px-3 py-1.5 text-[11px]" {...pager} /> : <div className="p-6 text-center text-xs text-faint">This group has no committed offsets.</div>}
        </div>
      </div>

      {resetting && (
        <ResetOffsetsDialog
          conn={conn}
          group={group}
          topics={topics}
          members={detail.members.map((m) => m.clientId)}
          onClose={() => setResetting(false)}
          onApplied={() => {
            setResetting(false)
            load()
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog destructive
          title={`Delete group "${group}"?`}
          description="Its committed offsets go with it — a consumer that joins under this id again starts from its auto.offset.reset position."
          typeToConfirm={group}
          confirmLabel="Delete group"
          onConfirm={remove}
          onCancel={() => setDeleting(false)}
        />
      )}
    </div>
  )
}
