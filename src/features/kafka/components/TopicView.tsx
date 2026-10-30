import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import RefreshButton from '@/shared/ui/buttons/RefreshButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import Popover from '@/shared/ui/overlay/Popover'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CodeIcon, CopyIcon, MoreVerticalIcon, SendIcon, TrashIcon } from '@/shared/ui/icons'
import { describeTopic, type TopicDetail } from '../lib/api'
import DeleteTopicDialog from './DeleteTopicDialog'
import MessageBrowser from './MessageBrowser'
import PartitionsPanel from './PartitionsPanel'
import TopicConfigPanel from './TopicConfigPanel'
import TopicConsumersPanel from './TopicConsumersPanel'

export type TopicSubView = 'messages' | 'partitions' | 'config' | 'consumers'

const VIEWS: { id: TopicSubView; label: string }[] = [
  { id: 'messages', label: 'Messages' },
  { id: 'partitions', label: 'Partitions' },
  { id: 'config', label: 'Configuration' },
  { id: 'consumers', label: 'Consumers' },
]

const REFRESH_MS = 10000

/**
 * One topic's tab: its header (name, shape, actions) over four views — the
 * message browser, partitions, configuration and the groups consuming it.
 *
 * The topic's description is read here and shared, and re-read every 10 s while
 * the Partitions view is showing: two reads apart is also how the produce rate
 * is measured, from the movement of the end offsets.
 */
export default function TopicView({
  conn,
  topic,
  view: initialView = 'messages',
  onViewChange,
  onProduce,
  onRunCommand,
  onOpenGroup,
  onDeleted,
}: {
  conn: any
  topic: string
  view?: TopicSubView
  onViewChange?: (view: TopicSubView) => void
  onProduce: (topic: string, draft?: { key?: string | null; value?: string | null; headers?: Record<string, string> | null }) => void
  onRunCommand: (command: string) => void
  onOpenGroup: (group: string) => void
  onDeleted: (topic: string) => void
}) {
  const toast = useToast()
  const [view, setView] = useState<TopicSubView>(initialView)
  const [detail, setDetail] = useState<TopicDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rate, setRate] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const last = useRef<{ at: number; end: number } | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await describeTopic(conn, topic)
      const end = d.partitionList.reduce((n, p) => n + p.high, 0)
      const now = Date.now()
      if (last.current && now > last.current.at) setRate(Math.max(0, ((end - last.current.end) * 1000) / (now - last.current.at)))
      last.current = { at: now, end }
      setDetail(d)
      setError(null)
    } catch (e: any) {
      setError(e.message)
    }
  }, [conn, topic])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (view !== 'partitions') return
    const iv = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS)
    return () => clearInterval(iv)
  }, [view, load])

  const pick = (v: TopicSubView) => {
    setView(v)
    onViewChange?.(v)
  }

  const cfg = (name: string) => detail?.configs.find((c) => c.name === name)?.value
  const retention = cfg('retention.ms')
  const badges = detail
    ? [
        `${detail.partitions} partition${detail.partitions === 1 ? '' : 's'}`,
        `RF ${detail.replication}`,
        cfg('min.insync.replicas') && `min ISR ${cfg('min.insync.replicas')}`,
        cfg('cleanup.policy') && `cleanup: ${cfg('cleanup.policy')}`,
        retention && `retention ${retention === '-1' ? '∞' : formatMs(Number(retention))}`,
        cfg('compression.type') && cfg('compression.type') !== 'producer' && `compression: ${cfg('compression.type')}`,
      ].filter(Boolean)
    : []

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-b border-edge px-[18px] pt-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="truncate font-mono text-[15px] font-bold" title={topic}>
                {topic}
              </h2>
              <Tooltip label="Copy name" placement="bottom">
                <IconButton
                  size="sm"
                  aria-label="Copy topic name"
                  onClick={() => navigator.clipboard?.writeText(topic).then(() => toast.success('Copied.'))}
                >
                  <CopyIcon width={13} height={13} />
                </IconButton>
              </Tooltip>
              {detail?.internal && <span className="rounded-[5px] border border-edge px-1.5 py-px text-[9px] font-semibold uppercase text-ink-faint">internal</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {badges.map((b) => (
                <span key={b as string} className="rounded-[6px] border border-edge bg-elevated px-2 py-0.5 text-[11px] text-ink-dim">
                  {b}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" icon={SendIcon} onClick={() => onProduce(topic)}>
              Produce
            </Button>
            <Tooltip label="Refresh" placement="bottom">
              <RefreshButton size="toolbar" iconSize={15} aria-label="Refresh topic" onRefresh={load} />
            </Tooltip>
            <Popover
              align="right"
              width={220}
              trigger={({ open, toggle }) => (
                <IconButton size="toolbar" active={open} onClick={toggle} aria-label="More topic actions">
                  <MoreVerticalIcon width={16} height={16} />
                </IconButton>
              )}
            >
              {({ close }) => (
                <div className="p-1">
                  <MenuItem onClick={() => { onRunCommand(`DESCRIBE ${topic}`); close() }}>
                    <CodeIcon width={14} height={14} /> Describe in console
                  </MenuItem>
                  <div className="my-1 h-px bg-edge" />
                  <MenuItem danger onClick={() => { setConfirmDelete(true); close() }}>
                    <TrashIcon width={14} height={14} /> Delete topic…
                  </MenuItem>
                </div>
              )}
            </Popover>
          </div>
        </div>
        <nav className="mt-3 flex gap-5" aria-label="Topic views">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => pick(v.id)}
              aria-current={view === v.id ? 'page' : undefined}
              className={`-mb-px border-b-2 pb-2 text-xs transition-colors ${
                view === v.id ? 'border-green font-medium text-ink' : 'border-transparent text-ink-dim hover:text-ink'
              }`}
            >
              {v.label}
            </button>
          ))}
        </nav>
      </div>

      {error && !detail && (
        <div className="mx-[18px] my-4 rounded-[9px] border border-red/25 bg-red/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">{error}</div>
      )}

      {view === 'messages' && (
        <MessageBrowser
          conn={conn}
          topic={topic}
          partitions={detail?.partitions || 0}
          onProduceCopy={(draft) => onProduce(topic, draft)}
          onRunCommand={onRunCommand}
        />
      )}
      {view === 'partitions' && <PartitionsPanel conn={conn} topic={topic} detail={detail} rate={rate} />}
      {view === 'config' && <TopicConfigPanel conn={conn} topic={topic} detail={detail} onChanged={load} />}
      {view === 'consumers' && <TopicConsumersPanel conn={conn} topic={topic} onOpenGroup={onOpenGroup} />}

      {confirmDelete && (
        <DeleteTopicDialog
          conn={conn}
          topic={topic}
          partitions={detail?.partitions}
          onClose={() => setConfirmDelete(false)}
          onDeleted={onDeleted}
        />
      )}
    </div>
  )
}

// 604800000 → "7 d", 3600000 → "1 h".
export function formatMs(ms: number) {
  if (!Number.isFinite(ms)) return String(ms)
  const units: [number, string][] = [
    [86400000, 'd'],
    [3600000, 'h'],
    [60000, 'min'],
    [1000, 's'],
  ]
  for (const [size, unit] of units) if (ms >= size && ms % size === 0) return `${ms / size} ${unit}`
  for (const [size, unit] of units) if (ms >= size) return `${(ms / size).toFixed(1)} ${unit}`
  return `${ms} ms`
}
