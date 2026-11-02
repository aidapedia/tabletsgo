import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { ColumnsIcon, SettingsIcon, TopicIcon, UsersIcon } from '@/shared/ui/icons'
import { describeTopic, type TopicDetail } from '../lib/api'
import MessageBrowser from './MessageBrowser'
import PartitionsPanel from './PartitionsPanel'
import TopicConfigPanel from './TopicConfigPanel'
import TopicConsumersPanel from './TopicConsumersPanel'

/** Each view of a topic is a console tab of its own. */
export type TopicSubView = 'messages' | 'partitions' | 'consumers' | 'config'

/** The views in menu order — the sidebar's row menu and a topic tab's right-click menu both list them. */
export const TOPIC_VIEWS: { id: TopicSubView; label: string; icon: (props: any) => ReactElement }[] = [
  { id: 'messages', label: 'Browse messages', icon: TopicIcon },
  { id: 'partitions', label: 'Partitions', icon: ColumnsIcon },
  { id: 'consumers', label: 'Consumers', icon: UsersIcon },
  { id: 'config', label: 'Configuration', icon: SettingsIcon },
]

const REFRESH_MS = 10000

/**
 * One topic's tab: one view of it — the message browser, partitions, the
 * groups consuming it, or configuration. There is no header: the topic's shape
 * is reported up through `onDetail` for the status bar, and its actions live in
 * the tab's and the sidebar row's menus.
 *
 * The topic's description is read here, and re-read every 10 s on the
 * Partitions view: two reads apart is also how the produce rate is measured,
 * from the movement of the end offsets.
 */
export default function TopicView({
  conn,
  topic,
  view = 'messages',
  onProduce,
  onRunCommand,
  onOpenGroup,
  onDetail,
}: {
  conn: any
  topic: string
  view?: TopicSubView
  onProduce: (topic: string, draft?: { key?: string | null; value?: string | null; headers?: Record<string, string> | null }) => void
  onRunCommand: (command: string) => void
  onOpenGroup: (group: string) => void
  /** Every fresh read of the topic's description — the console's status bar shows it. */
  onDetail?: (detail: TopicDetail) => void
}) {
  const [detail, setDetail] = useState<TopicDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rate, setRate] = useState<number | null>(null)
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

  // Report each fresh read up; held in a ref so an inline callback doesn't re-fire it.
  const onDetailRef = useRef(onDetail)
  onDetailRef.current = onDetail
  useEffect(() => {
    if (detail) onDetailRef.current?.(detail)
  }, [detail])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {error && !detail && (
        <div className="mx-[18px] my-4 rounded-[9px] border border-red/25 bg-red/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">{error}</div>
      )}

      {view === 'partitions' ? (
        <PartitionsPanel conn={conn} topic={topic} detail={detail} rate={rate} />
      ) : view === 'consumers' ? (
        <TopicConsumersPanel conn={conn} topic={topic} onOpenGroup={onOpenGroup} />
      ) : view === 'config' ? (
        <TopicConfigPanel conn={conn} topic={topic} detail={detail} onChanged={load} />
      ) : (
        <MessageBrowser
          conn={conn}
          topic={topic}
          partitions={detail?.partitions || 0}
          onProduce={() => onProduce(topic)}
          onProduceCopy={(draft) => onProduce(topic, draft)}
          onRunCommand={onRunCommand}
        />
      )}
    </div>
  )
}
