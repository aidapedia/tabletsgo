import type { TopicDetail, TopicSummary } from './api'
import { formatDate, formatTime, isSameDay } from '@/shared/lib/datetime'

/** 48213004 → "48.2M"; small numbers keep their digits. */
export function compact(n: number | null | undefined) {
  if (n == null) return '–'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e4) return `${(n / 1e3).toFixed(1)}k`
  return n.toLocaleString()
}

export const num = (n: number | null | undefined) => (n == null ? '–' : n.toLocaleString())

export function bytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** "2026-10-29T09:41:07.211Z" → "09:41:07.211" today, "Oct 28 09:41:07" otherwise. */
export function shortTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const time = formatTime(d, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  const today = isSameDay(d, Date.now())
  return today ? `${time}.${ms}` : `${formatDate(d, { month: 'short', day: 'numeric' })} ${time}`
}

// A consumer group's state as a dot colour and a badge tone. Kafka's states:
// Stable, Empty, PreparingRebalance, CompletingRebalance, Dead.
export function groupStateLook(state: string) {
  if (state === 'Stable') return { dot: 'bg-success', tone: 'default' as const, label: 'Stable' }
  if (/Rebalance/i.test(state)) return { dot: 'bg-warning', tone: 'warning' as const, label: 'Rebalancing' }
  if (state === 'Dead') return { dot: 'border border-faint', tone: 'faint' as const, label: 'Dead' }
  return { dot: 'bg-faint', tone: 'secondary' as const, label: state || 'Empty' }
}

// Lag big enough to look at gets amber; an order of magnitude more gets red.
export const lagTone = (lag: number | null | undefined) =>
  lag == null ? 'text-faint' : lag >= 10000 ? 'text-destructive' : lag >= 100 ? 'text-warning' : 'text-faint'

export type TopicTreeNode =
  | { kind: 'folder'; id: string; label: string; children: TopicSummary[] }
  | { kind: 'topic'; topic: TopicSummary }

/**
 * Topics grouped by their first dotted segment (`orders.created`,
 * `orders.paid` → an `orders` folder) once two or more share it; anything else
 * stays at the root. Folders first, then loose topics, both by name.
 */
export function buildTopicTree(topics: TopicSummary[]): TopicTreeNode[] {
  const byPrefix = new Map<string, TopicSummary[]>()
  for (const t of topics) {
    const prefix = t.name.includes('.') ? t.name.slice(0, t.name.indexOf('.')) : ''
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, [])
    byPrefix.get(prefix)!.push(t)
  }
  const folders: TopicTreeNode[] = []
  const loose: TopicTreeNode[] = []
  for (const [prefix, list] of byPrefix) {
    if (prefix && list.length > 1) folders.push({ kind: 'folder', id: prefix, label: prefix, children: list })
    else for (const t of list) loose.push({ kind: 'topic', topic: t })
  }
  const name = (n: TopicTreeNode) => (n.kind === 'folder' ? n.label : n.topic.name)
  return [...folders.sort((a, b) => name(a).localeCompare(name(b))), ...loose.sort((a, b) => name(a).localeCompare(name(b)))]
}

/** Pretty-print a value when it is JSON; otherwise hand it back untouched. */
export function prettyJson(value: string | null) {
  if (value == null) return { text: '', json: false }
  try {
    return { text: JSON.stringify(JSON.parse(value), null, 2), json: true }
  } catch {
    return { text: value, json: false }
  }
}

// A string as a single-quoted command argument (doubling any quote inside).
export const quote = (s: string) => `'${String(s).replace(/'/g, "''")}'`

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

/** A topic's shape in a few short facts — what the status bar shows for a topic tab. */
export function topicFacts(detail: TopicDetail): string[] {
  const cfg = (name: string) => detail.configs.find((c) => c.name === name)?.value
  const retention = cfg('retention.ms')
  const compression = cfg('compression.type')
  return [
    detail.internal && 'internal',
    `${detail.partitions} partition${detail.partitions === 1 ? '' : 's'}`,
    `RF ${detail.replication}`,
    cfg('min.insync.replicas') && `min ISR ${cfg('min.insync.replicas')}`,
    cfg('cleanup.policy') && `cleanup: ${cfg('cleanup.policy')}`,
    retention && `retention ${retention === '-1' ? '∞' : formatMs(Number(retention))}`,
    compression && compression !== 'producer' && `compression: ${compression}`,
  ].filter(Boolean) as string[]
}
