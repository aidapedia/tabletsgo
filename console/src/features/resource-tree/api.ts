import { request, safeRequest } from '@/shared/api/request'
import type { NodeDetail, NodeMember, PrincipalType, ResourceGrant, ResourceNode, TreeCatalog } from './types'

// Reads degrade quietly — an empty tree renders as the empty state, which is a
// better answer than a red banner on the home page.
export const fetchResourceTree = () => safeRequest<ResourceNode[]>('/resource-tree', [])

export const fetchCatalog = () => safeRequest<TreeCatalog>('/resource-tree/catalog', { nodeTypes: [], roles: [] })

export const fetchNode = (id: string) => request<NodeDetail>(`/resource-tree/${id}`)

// ---- Mutations (throw; the caller toasts) ----

export const createGroup = (parentId: string, name: string) =>
  request<ResourceNode>(`/resource-tree/${parentId}/groups`, { method: 'POST', body: { name } })

export const renameNode = (id: string, name: string) =>
  request<ResourceNode>(`/resource-tree/${id}`, { method: 'PUT', body: { name } })

export const moveNode = (id: string, parentId: string) =>
  request<ResourceNode>(`/resource-tree/${id}/move`, { method: 'PUT', body: { parentId } })

export const setNodeOwner = (id: string, ownerId: string | null) =>
  request<ResourceNode>(`/resource-tree/${id}/owner`, { method: 'PUT', body: { ownerId } })

export const deleteNode = (id: string) => request<{ ok: true }>(`/resource-tree/${id}`, { method: 'DELETE' })

export const addGrant = (
  nodeId: string,
  grant: { principalType: PrincipalType; principalId: string; roleSlug: string; inherit?: boolean }
) => request<ResourceGrant>(`/resource-tree/${nodeId}/grants`, { method: 'POST', body: grant })

export const removeGrant = (nodeId: string, grantId: string) =>
  request<{ ok: true }>(`/resource-tree/${nodeId}/grants/${grantId}`, { method: 'DELETE' })

// ---- Membership: who is inside a group ----
// Separate from grants on purpose. A grant on a group node says what its holder
// may do there; the roster decides who every grant made *to* that group reaches.

export const fetchNodeMembers = (nodeId: string) => safeRequest<NodeMember[]>(`/resource-tree/${nodeId}/members`, [])

export const addNodeMember = (nodeId: string, userId: string) =>
  request<{ ok: true }>(`/resource-tree/${nodeId}/members`, { method: 'POST', body: { userId } })

export const removeNodeMember = (nodeId: string, userId: string) =>
  request<{ ok: true }>(`/resource-tree/${nodeId}/members/${userId}`, { method: 'DELETE' })
