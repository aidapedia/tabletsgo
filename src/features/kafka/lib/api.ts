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
  message: { key?: string | null; value: string | null; headers?: Record<string, string> | null; partition?: number | null }
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
