import { request } from '@/shared/api/request'

// The /streams/* routes. Named for the capability, not the engine — another
// log-shaped engine answers the same calls.

export type StreamOverview = {
  clusterId: string
  controller: number
  brokers: { nodeId: number; host: string; port: number }[]
  topicCount: number
  internalTopicCount: number
}

export type TopicSummary = {
  name: string
  internal: boolean
  partitions: number
  replication: number
  underReplicated: number
}

export type PartitionInfo = {
  partition: number
  leader: number
  replicas: number[]
  isr: number[]
  offline: number[]
  low: number
  high: number
  messages: number
}

export type TopicConfig = { name: string; value: string | null; isDefault: boolean; readOnly: boolean; sensitive: boolean }

export type TopicDetail = TopicSummary & {
  messages: number
  partitionList: PartitionInfo[]
  configs: TopicConfig[]
}

export type MessageRow = {
  partition: number
  offset: number
  timestamp: string
  key: string | null
  value: string | null
  /** JSON object of header → value, or null when the message has none. */
  headers: string | null
  size: number
}

export type MessagePage = {
  columns: string[]
  rows: MessageRow[]
  scanned: number
  matched: number
  truncated: boolean
  cappedBy: 'time' | 'bytes' | null
  /** Per partition: the offset older messages end at. */
  cursor: Record<string, number>
  elapsedMs: number
}

export type ReadOptions = {
  partition?: number | null
  /** latest | earliest | -N | offset:N | ts:<ISO> */
  from?: string
  limit?: number
  filter?: string
  decode?: string
}

export type GroupSummary = {
  id: string
  state: string
  protocol: string | null
  members: number
  topics: string[]
  /** Across every topic the group reads; `lagByTopic` splits it per topic. */
  lag: number
  lagByTopic: Record<string, number>
}

export type GroupOffset = {
  topic: string
  partition: number
  committed: number
  end: number | null
  lag: number | null
  member: string | null
  host: string | null
}

export type GroupDetail = {
  id: string
  state: string
  protocol: string | null
  members: { memberId: string; clientId: string; host: string; assignment: Record<string, number[]> }[]
  offsets: GroupOffset[]
  lag: number
}

export type ResetStrategy = 'earliest' | 'latest' | 'timestamp' | 'offset' | 'shift'
export type ResetRow = { partition: number; current: number | null; target: number; delta: number | null }

const base = (conn: any) => `/connections/${conn.id}/streams`
const enc = encodeURIComponent

export const getOverview = (conn: any) => request<StreamOverview>(`${base(conn)}/overview`)

export function listTopics(conn: any, { pattern = '', internal = false }: { pattern?: string; internal?: boolean } = {}) {
  const params = new URLSearchParams({ pattern, internal: internal ? '1' : '0' })
  return request<TopicSummary[]>(`${base(conn)}/topics?${params}`)
}

export const describeTopic = (conn: any, topic: string) => request<TopicDetail>(`${base(conn)}/topics/${enc(topic)}`)

export const createTopic = (
  conn: any,
  spec: { name: string; partitions?: number; replication?: number; configs?: Record<string, string>; validateOnly?: boolean }
) => request<{ ok: true; name: string }>(`${base(conn)}/topics`, { method: 'POST', body: spec })

/** `configs` merge into the topic's overrides; a null value removes one. */
export const alterTopic = (conn: any, topic: string, change: { configs?: Record<string, string | null>; partitions?: number }) =>
  request<{ ok: true }>(`${base(conn)}/topics/${enc(topic)}`, { method: 'PATCH', body: change })

export const deleteTopic = (conn: any, topic: string) =>
  request<{ ok: true }>(`${base(conn)}/topics/${enc(topic)}`, { method: 'DELETE', body: { confirm: topic } })

export function readMessages(conn: any, topic: string, opts: ReadOptions = {}) {
  const params = new URLSearchParams()
  if (opts.partition !== undefined && opts.partition !== null) params.set('partition', String(opts.partition))
  if (opts.from) params.set('from', opts.from)
  if (opts.limit) params.set('limit', String(opts.limit))
  if (opts.filter?.trim()) params.set('filter', opts.filter.trim())
  if (opts.decode) params.set('decode', opts.decode)
  return request<MessagePage>(`${base(conn)}/topics/${enc(topic)}/messages?${params}`)
}

export const produceMessage = (
  conn: any,
  topic: string,
  message: {
    key?: string | null
    value: string | null
    headers?: Record<string, string> | null
    partition?: number | null
    keySchema?: SchemaRef | null
    valueSchema?: SchemaRef | null
  }
) =>
  request<{ topic: string; partition: number; offset: number; timestamp: number }>(`${base(conn)}/topics/${enc(topic)}/messages`, {
    method: 'POST',
    body: message,
  })

export const listGroups = (conn: any) => request<GroupSummary[]>(`${base(conn)}/groups`)

export const describeGroup = (conn: any, id: string) => request<GroupDetail>(`${base(conn)}/groups/${enc(id)}`)

/** Always a dry run unless `apply` — which must echo the group id as `confirm`. */
export const resetOffsets = (
  conn: any,
  id: string,
  spec: { topic: string; strategy: ResetStrategy; value?: string; partitions?: number[] },
  apply = false
) =>
  request<{ offsets: ResetRow[]; dryRun: boolean }>(`${base(conn)}/groups/${enc(id)}/offsets`, {
    method: 'PUT',
    body: { ...spec, dryRun: !apply, ...(apply ? { confirm: id } : {}) },
  })

export const deleteGroup = (conn: any, id: string) =>
  request<{ ok: true }>(`${base(conn)}/groups/${enc(id)}`, { method: 'DELETE', body: { confirm: id } })

/** Empty a topic (or some partitions) and keep it — must echo the topic as `confirm`. */
export const clearTopic = (conn: any, topic: string, partitions?: number[]) =>
  request<{ ok: true; cleared: number; partitions: number[] }>(`${base(conn)}/topics/${enc(topic)}/messages`, {
    method: 'DELETE',
    body: { confirm: topic, ...(partitions?.length ? { partitions } : {}) },
  })

// ---- Brokers ----

export type BrokerStats = {
  nodeId: number
  host: string
  port: number
  controller: boolean
  leaders: number
  replicas: number
  outOfSync: number
  offline: number
  /** Leaders over an even share, in percent: 0 is balanced. */
  leaderSkew: number
}

export type BrokerList = {
  clusterId: string
  controller: number | null
  topics: number
  partitions: number
  underReplicated: number
  offlinePartitions: number
  brokers: BrokerStats[]
}

export type BrokerConfig = TopicConfig & { dynamic: boolean }

export const listBrokers = (conn: any) => request<BrokerList>(`${base(conn)}/brokers`)

export const describeBroker = (conn: any, id: number) =>
  request<{ nodeId: number; host: string; port: number; configs: BrokerConfig[] }>(`${base(conn)}/brokers/${id}`)

/** Merged into the broker's dynamic overrides; a null value removes one. */
export const alterBroker = (conn: any, id: number, configs: Record<string, string | null>) =>
  request<{ ok: true }>(`${base(conn)}/brokers/${id}`, { method: 'PATCH', body: { configs } })

// ---- Schema registry ----

export type SchemaType = 'AVRO' | 'PROTOBUF' | 'JSON'
export type SchemaSubject = { subject: string; version: number | null; id: number | null; type: SchemaType | null; error?: string }
export type SchemaVersion = { version: number; id: number; type: SchemaType; schema: string; references: { name: string; subject: string; version: number }[] }
export type SchemaDetail = {
  subject: string
  compatibility: string
  compatibilityInherited: boolean
  registryCompatibility: string
  versions: SchemaVersion[]
}
/** Writes one side of a message with a registry schema; the text sent is its JSON. */
export type SchemaRef = { subject: string; version?: number | 'latest'; message?: string }

export const COMPATIBILITY_LEVELS = ['BACKWARD', 'BACKWARD_TRANSITIVE', 'FORWARD', 'FORWARD_TRANSITIVE', 'FULL', 'FULL_TRANSITIVE', 'NONE']

/** The connection names a Schema Registry (a connection setting). */
export const hasSchemaRegistry = (conn: any) => Boolean(conn?.schemaRegistryUrl?.trim())

export const listSchemas = (conn: any) => request<{ compatibility: string; subjects: SchemaSubject[] }>(`${base(conn)}/schemas`)

export const describeSchema = (conn: any, subject: string) => request<SchemaDetail>(`${base(conn)}/schemas/${enc(subject)}`)

export const registerSchema = (conn: any, subject: string, spec: { schema: string; type: SchemaType; validateOnly?: boolean }) =>
  request<{ id: number; version: number } & { compatible?: boolean; messages?: string[]; firstVersion?: boolean }>(`${base(conn)}/schemas/${enc(subject)}`, {
    method: 'POST',
    body: spec,
  })

/** One version, or the whole subject; `permanent` hard-deletes. Must echo the subject as `confirm`. */
export const deleteSchema = (conn: any, subject: string, opts: { version?: number; permanent?: boolean } = {}) =>
  request<{ ok: true }>(`${base(conn)}/schemas/${enc(subject)}`, { method: 'DELETE', body: { confirm: subject, ...opts } })

/** A subject's own rule, or the registry's (no subject). null returns a subject to the registry's rule. */
export const setSchemaCompatibility = (conn: any, subject: string | null, compatibility: string | null) =>
  request<{ ok: true }>(subject ? `${base(conn)}/schemas/${enc(subject)}/config` : `${base(conn)}/schemas/config`, {
    method: 'PUT',
    body: { compatibility },
  })

// ---- ACLs ----

export type Acl = {
  principal: string
  host: string
  operation: string
  permission: 'ALLOW' | 'DENY'
  resourceType: string
  resourceName: string
  patternType: 'LITERAL' | 'PREFIXED'
}

export const ACL_RESOURCE_TYPES = ['TOPIC', 'GROUP', 'CLUSTER', 'TRANSACTIONAL_ID', 'DELEGATION_TOKEN']
export const ACL_OPERATIONS = ['ALL', 'READ', 'WRITE', 'CREATE', 'DELETE', 'ALTER', 'DESCRIBE', 'CLUSTER_ACTION', 'DESCRIBE_CONFIGS', 'ALTER_CONFIGS', 'IDEMPOTENT_WRITE']

export function listAcls(conn: any, filter: { principal?: string; resourceType?: string; resourceName?: string } = {}) {
  const params = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][])
  return request<Acl[]>(`${base(conn)}/acls?${params}`)
}

export const createAcls = (conn: any, acls: Partial<Acl>[]) => request<{ ok: true; created: number }>(`${base(conn)}/acls`, { method: 'POST', body: { acls } })

export const deleteAcls = (conn: any, acls: Acl[]) => request<{ ok: true; deleted: number }>(`${base(conn)}/acls`, { method: 'DELETE', body: { acls } })

// ---- Connectors ----

export type ConnectorTask = { id: number; state: string; workerId: string; trace: string | null }
export type ConnectorSummary = {
  name: string
  type: 'source' | 'sink' | null
  state: string
  workerId: string | null
  className: string | null
  tasks: ConnectorTask[]
  failedTasks: number
  trace?: string | null
}
export type ConnectorDetail = ConnectorSummary & { config: Record<string, string>; topics: string[] }
export type ConnectorAction = 'pause' | 'resume' | 'stop' | 'restart' | 'restartTask' | 'resetOffsets'

/** The connection names a Kafka Connect cluster (a connection setting). */
export const hasConnect = (conn: any) => Boolean(conn?.connectUrl?.trim())

export const listConnectors = (conn: any) => request<ConnectorSummary[]>(`${base(conn)}/connectors`)
export const listConnectorPlugins = (conn: any) => request<{ className: string; type: string; version: string }[]>(`${base(conn)}/connector-plugins`)
export const describeConnector = (conn: any, name: string) => request<ConnectorDetail>(`${base(conn)}/connectors/${enc(name)}`)

export const saveConnector = (conn: any, name: string, config: Record<string, string>) =>
  request<{ ok: true; name: string }>(`${base(conn)}/connectors/${enc(name)}`, { method: 'PUT', body: { config } })

export const validateConnector = (conn: any, name: string, config: Record<string, string>) =>
  request<{ errorCount: number; errors: { name: string; errors: string[] }[] }>(`${base(conn)}/connectors/${enc(name)}`, {
    method: 'PUT',
    body: { config, validateOnly: true },
  })

export const connectorAction = (conn: any, name: string, action: ConnectorAction, opts: { task?: number; onlyFailed?: boolean } = {}) =>
  request<{ ok: true }>(`${base(conn)}/connectors/${enc(name)}/actions`, { method: 'POST', body: { action, ...opts } })

export const deleteConnector = (conn: any, name: string) =>
  request<{ ok: true }>(`${base(conn)}/connectors/${enc(name)}`, { method: 'DELETE', body: { confirm: name } })

// ---- Streaming SQL (ksqlDB) ----

export type SqlResult =
  | { statement: string; type: 'rows'; columns: string[]; rows: Record<string, unknown>[]; message?: string; truncated?: boolean; cappedBy?: 'rows' | 'time' | null }
  | { statement: string; type: 'message'; message: string }

export type SqlCatalog = {
  streams: { name: string; topic: string; keyFormat: string; valueFormat: string; system: boolean }[]
  tables: { name: string; topic: string; keyFormat: string; valueFormat: string; windowed: boolean }[]
  queries: { id: string; state: string; sinks: string[]; statement: string }[]
}

/** The connection names a ksqlDB server (a connection setting). */
export const hasKsql = (conn: any) => Boolean(conn?.ksqlUrl?.trim())

export const runStreamSql = (conn: any, sql: string, opts: { properties?: Record<string, string>; limit?: number } = {}) =>
  request<{ results: SqlResult[] }>(`${base(conn)}/sql`, { method: 'POST', body: { sql, ...opts } })

export const streamSqlCatalog = (conn: any) => request<SqlCatalog>(`${base(conn)}/sql/catalog`)
