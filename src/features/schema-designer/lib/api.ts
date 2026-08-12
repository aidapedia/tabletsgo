// Workspace-wide schema drafts. Per-connection drafts are just saved queries,
// so they keep travelling through the saved-query client the console already
// uses — this is only the cross-connection read the console can't do.

import { request, safeRequest } from '@/shared/api/request'
import { deleteSaved } from '@/features/workspace/lib/savedQueries'
import type { SchemaDraft, SchemaDraftDetail, SchemaEngine, WorkspaceSchemaDraft } from '../types'
import type { SchemaLayout } from './design'

// Every schema draft in a workspace the caller can reach — one request rather
// than one per connection. The server filters by connection access, so this is
// never wider than reading each connection's saved queries would be.
export async function listWorkspaceSchemas(workspaceId: string): Promise<WorkspaceSchemaDraft[]> {
  if (!workspaceId) return []
  return safeRequest(`/workspaces/${workspaceId}/schemas`, [])
}

// One draft with its DDL, whichever kind it is — the standalone editor page
// opens both through this, so the id in the URL is enough and the page never
// has to know which table it came from. A draft on a connection the caller
// can't open 403s here rather than coming back connection-less.
export async function getWorkspaceSchema(workspaceId: string, id: string): Promise<SchemaDraftDetail> {
  return request(`/workspaces/${workspaceId}/schemas/${id}`)
}

// The engines a from-scratch schema can target. Read from the driver registry,
// so an engine that can't hold a schema (Redis reports no column types) never
// appears — the picker has no list of its own to fall behind.
export async function listSchemaEngines(): Promise<SchemaEngine[]> {
  return safeRequest('/schema-engines', [])
}

export async function getSchemaDraft(workspaceId: string, id: string): Promise<SchemaDraft> {
  return request(`/workspaces/${workspaceId}/schema-drafts/${id}`)
}

export async function createSchemaDraft(
  workspaceId: string,
  fields: { name: string; dbType: string; sql?: string; layout?: SchemaLayout | null }
): Promise<SchemaDraft> {
  return request(`/workspaces/${workspaceId}/schema-drafts`, { method: 'POST', body: fields })
}

// Partial — the diagram saves `sql` and `layout` together, a rename saves `name`.
export async function updateSchemaDraft(
  workspaceId: string,
  id: string,
  fields: { name?: string; sql?: string; layout?: SchemaLayout | null }
): Promise<SchemaDraft> {
  return request(`/workspaces/${workspaceId}/schema-drafts/${id}`, { method: 'PUT', body: fields })
}

export async function deleteSchemaDraft(workspaceId: string, id: string): Promise<void> {
  return request(`/workspaces/${workspaceId}/schema-drafts/${id}`, { method: 'DELETE' })
}

// Drop a draft, whichever kind it is.
//
// The two kinds live in different tables — a workspace row versus that
// connection's saved query — so "delete this draft" is two routes, and the
// caller shouldn't have to know which. Same branch `linkToConnection` makes in
// the other direction; the connection, its tables and its schema history are
// untouched either way, because a draft is staged DDL and nothing else.
//
// Deep import rather than the `@/features/workspace` barrel: that barrel
// re-exports the whole DB console (QueryEditor pulls CodeMirror in), and the
// schema list only wants the saved-query delete. Importing the function rather
// than re-declaring its URL keeps one definition of where a saved query lives.
export async function deleteWorkspaceSchema(
  workspaceId: string,
  draft: { id: string; connectionId: string | null }
): Promise<void> {
  if (draft.connectionId) return deleteSaved(draft.connectionId, draft.id)
  return deleteSchemaDraft(workspaceId, draft.id)
}
