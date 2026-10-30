// Public API for the Kafka feature (topics, messages, consumer groups).
//
// NOTE: KafkaConsole/KafkaEditor are intentionally NOT re-exported here — they
// pull in CodeMirror, so the console lazy-imports them directly from
// `@/features/kafka/components/KafkaConsole`, the same code-split rule as
// RedisConsole, WorkflowEditor and DashboardView.
export { default as KafkaSidebar } from '@/features/kafka/components/KafkaSidebar'
export { default as TopicView } from '@/features/kafka/components/TopicView'
export { TOPIC_VIEWS } from '@/features/kafka/components/TopicView'
export type { TopicSubView } from '@/features/kafka/components/TopicView'
export { default as GroupView } from '@/features/kafka/components/GroupView'
export { default as ProduceView } from '@/features/kafka/components/ProduceView'

export * from '@/features/kafka/lib/api'
export { KAFKA_COMMANDS, findKafkaCommand } from '@/features/kafka/lib/commands'
export type { KafkaCommandSpec } from '@/features/kafka/lib/commands'
