// Public API for the Kafka feature (topics, messages, consumer groups).
//
// NOTE: KafkaConsole/KafkaEditor are intentionally NOT re-exported here — they
// pull in CodeMirror, so the console lazy-imports them directly from
// `@/features/kafka/components/KafkaConsole`, the same code-split rule as
// RedisConsole, WorkflowEditor and DashboardView.
export { default as KafkaSidebar } from '@/features/kafka/components/KafkaSidebar'
export { default as ConsumerGroupsSidebar } from '@/features/kafka/components/ConsumerGroupsSidebar'
export { default as TopicView } from '@/features/kafka/components/TopicView'
export { TOPIC_VIEWS } from '@/features/kafka/components/TopicView'
export type { TopicSubView } from '@/features/kafka/components/TopicView'
export { default as GroupView } from '@/features/kafka/components/GroupView'
export { default as ProduceView } from '@/features/kafka/components/ProduceView'
export { default as TopicMenuItems } from '@/features/kafka/components/TopicMenuItems'
export { default as DeleteTopicDialog } from '@/features/kafka/components/DeleteTopicDialog'
export { default as ClearTopicDialog } from '@/features/kafka/components/ClearTopicDialog'
export { default as CreateTopicDialog } from '@/features/kafka/components/CreateTopicDialog'
export { default as ClusterView } from '@/features/kafka/components/ClusterView'
export { default as SchemaRegistrySidebar } from '@/features/kafka/components/SchemaRegistrySidebar'
export { default as SubjectView } from '@/features/kafka/components/SubjectView'
export { default as ConnectSidebar } from '@/features/kafka/components/ConnectSidebar'
export { default as ConnectorView } from '@/features/kafka/components/ConnectorView'
export type { ConnectorDraft } from '@/features/kafka/components/ConnectorView'
export { default as KsqlSidebar } from '@/features/kafka/components/KsqlSidebar'
export { default as KsqlView } from '@/features/kafka/components/KsqlView'
export { SERVICE_PANELS, servicePanelsFor, CLUSTER_PANELS, kafkaPanelsFor } from '@/features/kafka/lib/services'
export type { ServicePanel, ClusterPanel, KafkaPanel } from '@/features/kafka/lib/services'

export * from '@/features/kafka/lib/api'
export { topicFacts } from '@/features/kafka/lib/format'
export { KAFKA_COMMANDS, findKafkaCommand } from '@/features/kafka/lib/commands'
export type { KafkaCommandSpec } from '@/features/kafka/lib/commands'
