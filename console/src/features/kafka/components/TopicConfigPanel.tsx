import { alterTopic, type TopicConfig, type TopicDetail } from '../lib/api'
import ConfigList from './ConfigList'

const isOverride = (c: TopicConfig) => !c.isDefault

/**
 * A topic's configuration. A change is merged into the existing overrides
 * server-side — Kafka's AlterConfigs would otherwise reset everything else.
 */
export default function TopicConfigPanel({
  conn,
  topic,
  detail,
  onChanged,
}: {
  conn: any
  topic: string
  detail: TopicDetail | null
  /** Re-reads the topic — after a change, or from the refresh button. */
  onChanged: () => unknown
}) {
  if (!detail) return <div className="p-[30px] text-center text-xs text-faint">Reading {topic}…</div>

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">
      <ConfigList
        configs={detail.configs}
        isOverride={isOverride}
        subject="the cluster default"
        emptyText='Nothing is overridden on this topic — turn on "Show defaults" to see what it inherits.'
        onSave={async (name, value) => {
          await alterTopic(conn, topic, { configs: { [name]: value } })
          onChanged()
        }}
        onRefresh={onChanged}
      />
    </div>
  )
}
