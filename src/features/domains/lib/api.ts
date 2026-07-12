// Per-connection domains, persisted on the backend. A domain (name + color)
// groups tables; each table belongs to at most one domain. The list endpoint
// embeds each domain's tables so one fetch drives both the picker and the
// grouped sidebar / schema-diagram regions.

import { request, safeRequest } from '@/shared/api/request'
import type { Domain } from '../types'

export async function fetchDomains(connectionId): Promise<Domain[]> {
  if (!connectionId) return []
  return safeRequest(`/connections/${connectionId}/domains`, [])
}

export async function createDomain(connectionId, { name, color }: { name: string; color?: string | null }) {
  return request<Domain>(`/connections/${connectionId}/domains`, { method: 'POST', body: { name, color } })
}

export async function updateDomain(connectionId, domainId, fields: { name?: string; color?: string | null }) {
  return request<Domain>(`/connections/${connectionId}/domains/${domainId}`, { method: 'PUT', body: fields })
}

export async function deleteDomain(connectionId, domainId) {
  await request(`/connections/${connectionId}/domains/${domainId}`, { method: 'DELETE' })
}

// Assign a table to a domain, or clear it with `domainId: null`.
export async function setTableDomain(connectionId, table, domainId: string | null) {
  await request(`/connections/${connectionId}/tables/${encodeURIComponent(table)}/domain`, {
    method: 'PUT',
    body: { domainId },
  })
}
