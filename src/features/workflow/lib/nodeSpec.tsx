// Single source of truth for the workflow node catalog: category, label, icon,
// accent colour, default `data`, and how each node summarises its config on the
// canvas. Drives the palette, the node cards, and the config panel.

import type { ComponentType } from 'react'
import { BellIcon, BranchIcon, ClockIcon, CloudIcon, CodeIcon, DatabaseIcon, DownloadIcon, GlobeIcon, LoopIcon, PlayIcon } from '@/shared/ui/icons'

export type NodeType = 'manual' | 'schedule' | 'webhook' | 'query' | 'http' | 'js' | 'switch' | 'loop' | 'export' | 'storage'
export type NodeCategory = 'Trigger' | 'Source' | 'Script' | 'Control' | 'Destination'

// Opaque, URL-safe token minted when a webhook node is created — it's the only
// gate on the public inbound hook route, so it must be unguessable.
export const genWebhookToken = () =>
  (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '')

type IconType = ComponentType<{ width?: number; height?: number; className?: string }>

export type NodeSpec = {
  type: NodeType
  category: NodeCategory
  label: string
  description: string
  icon: IconType
  accent: string // tailwind text colour class for the icon chip
  hasInput: boolean // draws a target handle on the left
  defaultData: () => Record<string, any>
  summary: (data: any) => string // one-line config summary shown on the card
}

const firstLine = (s?: string) => (s || '').trim().split('\n')[0]

export const NODE_SPECS: Record<NodeType, NodeSpec> = {
  manual: {
    type: 'manual',
    category: 'Trigger',
    label: 'Manual Trigger',
    description: 'Starts the workflow when you press Run. No configuration needed.',
    icon: PlayIcon,
    accent: 'text-green-bright',
    hasInput: false,
    defaultData: () => ({}),
    summary: () => 'Runs when you press Run',
  },
  schedule: {
    type: 'schedule',
    category: 'Trigger',
    label: 'Schedule Run',
    description: 'Runs the workflow automatically. Set a frequency here, then flip the workflow to Active.',
    icon: ClockIcon,
    accent: 'text-amber',
    hasInput: false,
    defaultData: () => ({ frequency: 'manual', hourOfDay: 0 }),
    summary: (d) =>
      d.frequency === 'hourly' ? 'Every hour' : d.frequency === 'daily' ? `Daily at ${String(d.hourOfDay ?? 0).padStart(2, '0')}:00 UTC` : 'Manual only',
  },
  webhook: {
    type: 'webhook',
    category: 'Trigger',
    label: 'Webhook',
    description:
      'Runs when an external HTTP request hits this workflow\'s hook URL. The request { body, query, headers, method } becomes the trigger input.',
    icon: BellIcon,
    accent: 'text-pink-400',
    hasInput: false,
    defaultData: () => ({ token: genWebhookToken() }),
    summary: () => 'Runs on inbound HTTP request',
  },
  query: {
    type: 'query',
    category: 'Source',
    label: 'Run a query',
    description: 'Run SQL against this connection. Inline input values as {{input.field}}. Output: { columns, rows }.',
    icon: DatabaseIcon,
    accent: 'text-green-bright',
    hasInput: true,
    defaultData: () => ({ sql: '' }),
    summary: (d) => firstLine(d.sql) || 'No query yet',
  },
  http: {
    type: 'http',
    category: 'Source',
    label: 'HTTP Request',
    description: 'Call an HTTP endpoint from the server. Output: { status, headers, body }.',
    icon: GlobeIcon,
    accent: 'text-sky-400',
    hasInput: true,
    defaultData: () => ({ method: 'GET', url: '', headers: '', body: '' }),
    summary: (d) => (d.url?.trim() ? `${(d.method || 'GET').toUpperCase()} ${d.url.trim()}` : 'No URL yet'),
  },
  js: {
    type: 'js',
    category: 'Script',
    label: 'Run JavaScript',
    description:
      'Transform data. The body receives `input` and returns the node output. A `crypto` helper is available for hashing/HMAC signing (e.g. crypto.hmac).',
    icon: CodeIcon,
    accent: 'text-purple-400',
    hasInput: true,
    defaultData: () => ({ code: 'return input' }),
    summary: (d) => firstLine(d.code) || 'return input',
  },
  switch: {
    type: 'switch',
    category: 'Control',
    label: 'Switch Case',
    description: 'Route to the first matching case (a JS expression), else default.',
    icon: BranchIcon,
    accent: 'text-orange-400',
    hasInput: true,
    defaultData: () => ({ cases: [{ expr: '', label: 'Case 1' }] }),
    summary: (d) => `${d.cases?.length || 0} case${(d.cases?.length || 0) === 1 ? '' : 's'} + default`,
  },
  loop: {
    type: 'loop',
    category: 'Control',
    label: 'Loop',
    description: 'Iterate an array; run the body branch per item, then continue via done.',
    icon: LoopIcon,
    accent: 'text-teal-400',
    hasInput: true,
    defaultData: () => ({ itemsExpr: '' }),
    summary: (d) => (d.itemsExpr?.trim() ? `items: ${d.itemsExpr.trim()}` : 'Loops the input array'),
  },
  export: {
    type: 'export',
    category: 'Source',
    label: 'Export SQL',
    description: "Dumps this connection's full database to a SQL file. Output: { filePath, sizeBytes, dialect }.",
    icon: DownloadIcon,
    accent: 'text-green-bright',
    hasInput: true,
    defaultData: () => ({}),
    summary: () => 'Exports the full database as SQL',
  },
  storage: {
    type: 'storage',
    category: 'Destination',
    label: 'Store to Storage',
    description: 'Uploads the file produced by the previous node to one or more storage destinations.',
    icon: CloudIcon,
    accent: 'text-sky-400',
    hasInput: true,
    defaultData: () => ({ destinationIds: [] }),
    summary: (d) => `${d.destinationIds?.length || 0} destination${(d.destinationIds?.length || 0) === 1 ? '' : 's'}`,
  },
}

export const CATEGORIES: NodeCategory[] = ['Trigger', 'Source', 'Script', 'Control', 'Destination']

export const specsByCategory = (cat: NodeCategory) =>
  Object.values(NODE_SPECS).filter((s) => s.category === cat)

// Source handles for a node: default nodes have one ("out"); switch has one per
// case plus "default"; loop has "body" and "done".
export function sourceHandles(type: NodeType, data: any): { id: string; label: string }[] {
  if (type === 'switch') {
    const cases = (data?.cases || []).map((c: any, i: number) => ({ id: `case-${i}`, label: c.label || `Case ${i + 1}` }))
    return [...cases, { id: 'default', label: 'Default' }]
  }
  if (type === 'loop') {
    return [
      { id: 'body', label: 'Body' },
      { id: 'done', label: 'Done' },
    ]
  }
  return [{ id: 'out', label: 'Out' }]
}
