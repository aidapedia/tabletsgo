import type { ReactElement } from 'react'
import { DatabaseIcon, LinkIcon, NoteIcon, ShieldIcon, TerminalIcon, UsersIcon } from '@/shared/ui/icons'
import { hasConnect, hasKsql, hasSchemaRegistry } from './api'

export type ServicePanel = 'kafka-schemas' | 'kafka-connect' | 'kafka-ksql'

/**
 * The HTTP services beside a cluster, each a console rail entry with its own
 * sidebar — listed only when the connection names that service.
 */
export const SERVICE_PANELS: { id: ServicePanel; label: string; icon: (props: any) => ReactElement; available: (conn: any) => boolean }[] = [
  { id: 'kafka-schemas', label: 'Schema Registry', icon: NoteIcon, available: hasSchemaRegistry },
  { id: 'kafka-connect', label: 'Kafka Connect', icon: LinkIcon, available: hasConnect },
  { id: 'kafka-ksql', label: 'ksqlDB', icon: TerminalIcon, available: hasKsql },
]

/** The service rail entries a connection gets. */
export const servicePanelsFor = (conn: any) => SERVICE_PANELS.filter((p) => p.available(conn))

/** The cluster-wide views — each a console tab of its own (ClusterView), opened from the toolbar. */
export type ClusterPanel = 'brokers' | 'acls'

export const CLUSTER_PANELS: { id: ClusterPanel; label: string; icon: (props: any) => ReactElement }[] = [
  { id: 'brokers', label: 'Brokers', icon: DatabaseIcon },
  { id: 'acls', label: 'ACLs', icon: ShieldIcon },
]

export type KafkaPanel = 'kafka-groups' | ServicePanel

/**
 * Every rail entry a Kafka connection gets under Topics: its consumer groups,
 * always, then the services it names.
 */
export const kafkaPanelsFor = (conn: any): { id: KafkaPanel; label: string; icon: (props: any) => ReactElement }[] => [
  { id: 'kafka-groups', label: 'Consumer groups', icon: UsersIcon },
  ...servicePanelsFor(conn),
]
