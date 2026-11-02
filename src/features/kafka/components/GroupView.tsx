import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import RefreshButton from '@/shared/ui/buttons/RefreshButton'
import Badge from '@/shared/ui/Badge'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import TypeToConfirmDialog from '@/shared/ui/feedback/TypeToConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import { deleteGroup, describeGroup, type GroupDetail } from '../lib/api'
import { compact, groupStateLook, lagTone, num } from '../lib/format'
import ResetOffsetsDialog from './ResetOffsetsDialog'

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
  const toast = useToast()
  const [detail, setDetail] = useState<GroupDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [deleting, setDeleting] = useState(false)

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
    return <div className="mx-[18px] my-4 rounded-[9px] border border-red/25 bg-red/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">{error}</div>
  }
  if (!detail) return <div className="p-[30px] text-center text-xs text-ink-faint">Reading {group}…</div>

  const look = groupStateLook(detail.state)
  const active = detail.members.length > 0
  const busy = active ? `Stop its ${detail.members.length} consumer${detail.members.length === 1 ? '' : 's'} first — Kafka only changes an empty group.` : ''

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-edge px-[18px] py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-mono text-[15px] font-bold">{group}</h2>
            <Badge tone={look.tone}>{look.label}</Badge>
          </div>
          <p className="mt-1 text-[12px] text-ink-dim">
            {detail.members.length} member{detail.members.length === 1 ? '' : 's'} · {topics.length} topic{topics.length === 1 ? '' : 's'}
            {detail.protocol && ` · ${detail.protocol}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip label={busy || 'Move the group to another position'} placement="bottom">
            <Button variant="ghost" size="sm" onClick={() => setResetting(true)} disabled={!topics.length}>
              Reset offsets
            </Button>
          </Tooltip>
          <Tooltip label={busy || 'Delete the group and its committed offsets'} placement="bottom">
            <Button variant="danger" size="sm" onClick={() => setDeleting(true)} disabled={active}>
              Delete group
            </Button>
          </Tooltip>
          <Tooltip label="Refresh" placement="left">
            <RefreshButton size="toolbar" iconSize={15} aria-label="Refresh group" onRefresh={load} />
          </Tooltip>
        </div>
      </div>

      <div className="px-[18px] py-4">
        <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <div className={`rounded-card border px-4 py-3 ${detail.lag >= 10000 ? 'border-red/30 bg-red/5' : 'border-edge bg-panel'}`}>
            <p className={`text-[10px] font-semibold uppercase tracking-wide ${detail.lag >= 10000 ? 'text-red' : 'text-ink-faint'}`}>Total lag</p>
            <p className="mt-1 text-xl font-bold">{num(detail.lag)}</p>
          </div>
          <div className="rounded-card border border-edge bg-panel px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Partitions</p>
            <p className="mt-1 text-xl font-bold">{detail.offsets.length}</p>
          </div>
          <div className="rounded-card border border-edge bg-panel px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Members</p>
            <p className="mt-1 text-xl font-bold">{detail.members.length}</p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-card border border-edge bg-panel">
          <table className="w-full min-w-[720px] border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-[11px] text-ink-faint">
                <th className="h-8 border-b border-edge px-3 font-semibold">Topic</th>
                <th className="h-8 border-b border-edge px-3 text-right font-semibold">Partition</th>
                <th className="h-8 border-b border-edge px-3 text-right font-semibold">Committed</th>
                <th className="h-8 border-b border-edge px-3 text-right font-semibold">Log end</th>
                <th className="h-8 border-b border-edge px-3 text-right font-semibold">Lag</th>
                <th className="h-8 w-[140px] border-b border-edge px-3" />
                <th className="h-8 border-b border-edge px-3 font-semibold">Member</th>
              </tr>
            </thead>
            <tbody>
              {detail.offsets.map((o) => (
                <tr key={`${o.topic}:${o.partition}`}>
                  <td className="h-[30px] border-b border-edge/60 px-3">
                    <button type="button" className="font-mono hover:text-green" onClick={() => onOpenTopic(o.topic)}>
                      {o.topic}
                    </button>
                  </td>
                  <td className="border-b border-edge/60 px-3 text-right font-mono">{o.partition}</td>
                  <td className="border-b border-edge/60 px-3 text-right font-mono tabular-nums">{o.committed < 0 ? '–' : num(o.committed)}</td>
                  <td className="border-b border-edge/60 px-3 text-right font-mono tabular-nums">{num(o.end)}</td>
                  <td className={`border-b border-edge/60 px-3 text-right font-mono tabular-nums ${lagTone(o.lag)}`}>{compact(o.lag)}</td>
                  <td className="border-b border-edge/60 px-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
                      <div
                        className={`h-full rounded-full ${(o.lag || 0) >= 100 ? 'bg-amber' : 'bg-green'}`}
                        style={{ width: `${Math.max(o.lag ? 2 : 0, Math.round(((o.lag || 0) / maxLag) * 100))}%` }}
                      />
                    </div>
                  </td>
                  <td className="border-b border-edge/60 px-3 font-mono text-ink-dim">{o.member ? `${o.member}${o.host ? ` · ${o.host.replace(/^\//, '')}` : ''}` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!detail.offsets.length && <div className="p-6 text-center text-xs text-ink-faint">This group has no committed offsets.</div>}
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
        <TypeToConfirmDialog
          title={`Delete group "${group}"?`}
          message="Its committed offsets go with it — a consumer that joins under this id again starts from its auto.offset.reset position."
          confirmText={group}
          confirmLabel="Delete group"
          onConfirm={remove}
          onCancel={() => setDeleting(false)}
        />
      )}
    </div>
  )
}
