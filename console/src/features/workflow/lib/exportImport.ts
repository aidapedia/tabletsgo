// JSON export/import for a single workflow's graph. Mirrors the dashboard
// feature's export/import (types.ts DashboardExport + sanitizeConfig).

import { NODE_SPECS, genWebhookToken } from './nodeSpec'
import type { NodeType } from './nodeSpec'
import type { WorkflowGraph } from './api'

/** The JSON export/import document (graph + name, no ids tied to a server). */
export type WorkflowExport = { kind: 'workflow'; version: 1; name: string; graph: WorkflowGraph }

/** Normalize an untrusted parsed graph (import path) into a safe WorkflowGraph.
 * Also mints a fresh webhook token — tokens are secrets and never round-trip
 * through an export file (see `stripSecrets` used on export). */
export function sanitizeGraph(raw: any): WorkflowGraph {
  const rawNodes = Array.isArray(raw?.nodes) ? raw.nodes : []
  const rawEdges = Array.isArray(raw?.edges) ? raw.edges : []

  const nodes = rawNodes
    .filter((n: any) => n && typeof n === 'object' && typeof n.id === 'string' && n.type in NODE_SPECS)
    .map((n: any) => {
      const type = n.type as NodeType
      const { __status, ...data } = n.data && typeof n.data === 'object' ? n.data : {}
      return {
        id: n.id,
        type,
        position: {
          x: Number.isFinite(Number(n.position?.x)) ? Number(n.position.x) : 0,
          y: Number.isFinite(Number(n.position?.y)) ? Number(n.position.y) : 0,
        },
        data: type === 'webhook' ? { ...data, token: genWebhookToken() } : data,
      }
    })

  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges = rawEdges
    .filter(
      (e: any) =>
        e && typeof e === 'object' && typeof e.id === 'string' && nodeIds.has(e.source) && nodeIds.has(e.target)
    )
    .map((e: any) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: typeof e.sourceHandle === 'string' ? e.sourceHandle : undefined,
      targetHandle: typeof e.targetHandle === 'string' ? e.targetHandle : undefined,
    }))

  return { nodes, edges }
}

/** Strip transient run status + webhook secrets before an export leaves the browser. */
export function stripSecrets(graph: WorkflowGraph): WorkflowGraph {
  return {
    nodes: graph.nodes.map((n: any) => {
      const { __status, ...data } = n.data || {}
      if (n.type === 'webhook') {
        const { token, ...rest } = data
        return { ...n, data: rest }
      }
      return { ...n, data }
    }),
    edges: graph.edges,
  }
}
