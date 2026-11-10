import type { SshGateway, SshTransport } from '../types'

/**
 * Presets for the SSH host form. A provider is not stored — it is read back
 * from what is: Cloudflare is the `cloudflare` transport, Railway is plain SSH
 * to Railway's endpoint, anything else is a generic SSH server. So a preset
 * only decides which fields the form asks for and what it says about them.
 */
export type SshProvider = 'generic' | 'railway' | 'cloudflare'

export const RAILWAY_SSH_HOST = 'ssh.railway.com'

export const PROVIDERS: { value: SshProvider; label: string }[] = [
  { value: 'generic', label: 'SSH server' },
  { value: 'railway', label: 'Railway' },
  { value: 'cloudflare', label: 'Cloudflare Access' },
]

export const PROVIDER_LABEL: Record<SshProvider, string> = {
  generic: 'Direct',
  railway: 'Railway',
  cloudflare: 'Cloudflare',
}

export const providerOf = (g: { transport?: SshTransport; host?: string }): SshProvider =>
  g.transport === 'cloudflare' ? 'cloudflare' : (g.host || '').trim().toLowerCase() === RAILWAY_SSH_HOST ? 'railway' : 'generic'

export const transportOf = (p: SshProvider): SshTransport => (p === 'cloudflare' ? 'cloudflare' : 'tcp')

// Where a host is, as one line for lists and pickers.
export const addressOf = (g: SshGateway) =>
  g.transport === 'cloudflare' ? `${g.username}@${g.host} · Cloudflare` : `${g.username}@${g.host}:${g.port}`
