// A keypair the workspace holds. Only the public half ever reaches the client.
export type SshKey = {
  id: string
  workspaceId: string
  name: string
  algorithm: string
  publicKey: string
  fingerprint: string
  hasPassphrase: boolean
  createdAt: number | null
  updatedAt: number | null
}

export type SshKeyAlgorithm = 'ed25519' | 'rsa' | 'ecdsa'

// How an SSH host is reached: a direct TCP connection, or SSH carried over
// Cloudflare Access to the hostname of a host behind a Cloudflare Tunnel.
export type SshTransport = 'tcp' | 'cloudflare'

// A bastion a connection tunnels through ("SSH host" in the UI, "gateway" in
// the API). `hostFingerprint` is pinned the first time the app logs in to it;
// `hasPassword` / `hasServiceToken` stand in for the secrets themselves.
export type SshGateway = {
  id: string
  workspaceId: string
  name: string
  host: string
  port: number
  username: string
  auth: 'key' | 'password'
  keyId: string | null
  keyName: string | null
  hostFingerprint: string | null
  hasPassword: boolean
  transport: SshTransport
  serviceTokenId: string
  hasServiceToken: boolean
  createdAt: number | null
  updatedAt: number | null
}

export type SshTestResult = { ok: boolean; message: string; hint?: string; hostFingerprint?: string | null }
