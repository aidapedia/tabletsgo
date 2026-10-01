// SSH keys + gateways (workspace-scoped). Reads degrade to an empty list;
// mutations throw so the caller can toast the server's message.
import { request, safeRequest } from '@/shared/api/request'
import type { SshGateway, SshKey, SshKeyAlgorithm, SshTestResult, SshTransport } from '../types'

export const listSshKeys = (workspaceId: string): Promise<SshKey[]> => safeRequest(`/ssh/keys?workspace=${workspaceId}`, [])

export const createSshKey = (payload: {
  workspaceId: string
  name: string
  mode: 'generate' | 'import'
  algorithm?: SshKeyAlgorithm
  privateKey?: string
  passphrase?: string
}): Promise<SshKey> => request('/ssh/keys', { method: 'POST', body: payload })

export const renameSshKey = (id: string, name: string): Promise<SshKey> =>
  request(`/ssh/keys/${id}`, { method: 'PUT', body: { name } })

export const deleteSshKey = (id: string): Promise<void> => request(`/ssh/keys/${id}`, { method: 'DELETE' })

export const listSshGateways = (workspaceId: string): Promise<SshGateway[]> =>
  safeRequest(`/ssh/gateways?workspace=${workspaceId}`, [])

export type SshGatewayInput = {
  name: string
  host: string
  port: number | string
  username: string
  auth: 'key' | 'password'
  keyId?: string | null
  password?: string
  transport?: SshTransport
  serviceTokenId?: string
  serviceTokenSecret?: string
  resetHostKey?: boolean
}

export const createSshGateway = (payload: SshGatewayInput & { workspaceId: string }): Promise<SshGateway> =>
  request('/ssh/gateways', { method: 'POST', body: payload })

export const updateSshGateway = (id: string, fields: Partial<SshGatewayInput>): Promise<SshGateway> =>
  request(`/ssh/gateways/${id}`, { method: 'PUT', body: fields })

export const deleteSshGateway = (id: string): Promise<void> => request(`/ssh/gateways/${id}`, { method: 'DELETE' })

export const testSshGateway = (id: string): Promise<SshTestResult> => request(`/ssh/gateways/${id}/test`, { method: 'POST' })
