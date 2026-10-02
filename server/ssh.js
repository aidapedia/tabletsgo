/**
 * SSH keys and gateways — how a connection reaches a database that is only
 * listening on a private network.
 *
 * A **key** is a keypair the workspace holds. It is either generated here (the
 * private half never leaves the server; the public half is what someone pastes
 * into the bastion's `authorized_keys`) or imported from an existing private
 * key. Either way the public key and its fingerprint are plain columns, and the
 * private key (+ passphrase) is sealed in `credentials`.
 *
 * A **gateway** is a bastion host: host/port/user plus how to authenticate —
 * one of the workspace's keys, or a password — and how it is *reached*
 * (`transport`): a direct TCP connection, or a WebSocket through Cloudflare
 * Access for a host behind a Cloudflare Tunnel (./cloudflare-access.js). The
 * UI calls a gateway an "SSH host". A connection names a gateway by
 * `sshGatewayId` (inside its own sealed credentials); server/db/tunnel.js is
 * what actually opens the tunnel. The gateway's host key is pinned the first
 * time it is seen (trust on first use) so a swapped server is refused rather
 * than handed the database's credentials.
 *
 * Nothing secret ever leaves this module toward a client: the public shapes
 * report `hasPassphrase` / `hasPassword` instead.
 */

import { createHash, randomUUID } from 'crypto'
import ssh2 from 'ssh2'
import { db } from './meta.js'
import { SSH_CRED_KEY, decryptSecret, encryptSecret } from './crypto.js'
import { listConnections } from './connections.js'
import { explainAccessError, openAccessStream } from './cloudflare-access.js'

const { Client, utils } = ssh2

// What the generator offers. ed25519 is the default: short, fast, and what
// every current OpenSSH accepts. RSA stays for old bastions that predate it.
export const KEY_ALGORITHMS = {
  ed25519: { type: 'ed25519', opts: {} },
  rsa: { type: 'rsa', opts: { bits: 4096 } },
  ecdsa: { type: 'ecdsa', opts: { bits: 256 } },
}

// How a gateway is reached. 'tcp' is a plain connection to host:port;
// 'cloudflare' carries SSH over Cloudflare Access to the hostname in `host`.
export const TRANSPORTS = ['tcp', 'cloudflare']

// Railway's SSH endpoint. Nothing about it needs special handling — it is
// standard SSH — but a rejected login there is fixed in Railway, not in a
// server's authorized_keys, so the hint says so.
const RAILWAY_SSH_HOST = 'ssh.railway.com'

// Where Railway shows the one username a database service can use.
const RAILWAY_USERNAME_HELP =
  "use the service's public domain (myapp.up.railway.app) or, for a service with no domain such as a database, its service instance ID — open the service in the Railway dashboard (in the right environment), press ⌘K / Ctrl+K and choose \"Copy Service Instance ID\". That is not the Service ID or the project ID, though all three look alike"

// How long a gateway gets to complete the SSH handshake.
export const SSH_READY_TIMEOUT_MS = 15000

const sealed = (row) => {
  if (!row?.credentials) return {}
  try {
    return JSON.parse(decryptSecret(row.credentials, SSH_CRED_KEY))
  } catch {
    return {}
  }
}
const seal = (secrets) => encryptSecret(JSON.stringify(secrets), SSH_CRED_KEY)

// OpenSSH-style fingerprint of a public key blob: SHA256:<base64, unpadded>.
export const fingerprintOf = (blob) => `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`

// A 400 the routes can hand straight back.
const invalid = (message) => Object.assign(new Error(message), { status: 400 })

// Parse a private key into what the table stores. Refuses a public key, an
// encrypted key without its passphrase, and anything ssh2 can't read.
function describePrivateKey(privateKey, passphrase, comment) {
  const text = String(privateKey || '').trim()
  if (!text) throw invalid('Paste the private key.')
  let parsed = utils.parseKey(text, passphrase || undefined)
  if (Array.isArray(parsed)) parsed = parsed[0]
  if (parsed instanceof Error) {
    const message = /passphrase|encrypted/i.test(parsed.message)
      ? 'This key is encrypted — enter its passphrase.'
      : `Not a private key ssh2 can read: ${parsed.message}`
    throw invalid(message)
  }
  if (!parsed.isPrivateKey()) throw invalid('That is a public key — paste the private key (the file without .pub).')
  const blob = parsed.getPublicSSH()
  return {
    privateKey: `${text}\n`,
    algorithm: parsed.type,
    publicKey: `${parsed.type} ${blob.toString('base64')}${comment ? ` ${comment}` : ''}`,
    fingerprint: fingerprintOf(blob),
  }
}

// ---- Keys ----

export function rowToSshKey(row) {
  if (!row) return null
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    algorithm: row.algorithm || '',
    publicKey: row.public_key,
    fingerprint: row.fingerprint || '',
    hasPassphrase: !!sealed(row).passphrase,
    createdBy: row.created_by || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

const keyRow = async (id) => (id ? db().ssh_keys.findUnique({ where: { id } }) : null)

export const getSshKey = async (id) => rowToSshKey(await keyRow(id))

export const listSshKeys = async (workspaceId) =>
  (await db().ssh_keys.findMany({ where: { workspace_id: workspaceId }, orderBy: { created_at: 'asc' } })).map(rowToSshKey)

/**
 * Create a key. `mode: 'generate'` makes a fresh pair (`algorithm` picks it);
 * `mode: 'import'` takes an existing `privateKey` (+ `passphrase` if it has one).
 * The key's name doubles as the public key's comment, so the line in
 * `authorized_keys` says where it came from.
 */
export async function createSshKey(workspaceId, { name, mode = 'generate', algorithm = 'ed25519', privateKey, passphrase }, userId) {
  const label = String(name || '').trim()
  if (!label) throw invalid('A name is required.')
  const comment = label.replace(/\s+/g, '-')
  let described
  if (mode === 'import') {
    described = describePrivateKey(privateKey, passphrase, comment)
  } else {
    const algo = KEY_ALGORITHMS[algorithm]
    if (!algo) throw invalid(`Unknown key algorithm "${algorithm}".`)
    const pair = utils.generateKeyPairSync(algo.type, { ...algo.opts, comment })
    described = describePrivateKey(pair.private, undefined, comment)
    passphrase = undefined
  }
  const id = randomUUID()
  const now = Date.now()
  await db().ssh_keys.create({
    data: {
      id,
      workspace_id: workspaceId,
      name: label,
      algorithm: described.algorithm,
      public_key: described.publicKey,
      fingerprint: described.fingerprint,
      credentials: seal({ privateKey: described.privateKey, passphrase: passphrase || undefined }),
      created_by: userId || null,
      created_at: now,
      updated_at: now,
    },
  })
  return getSshKey(id)
}

// Only the name changes — a key's material is its identity, so a new key is a
// new row (and a gateway is repointed at it).
export async function renameSshKey(id, name) {
  const label = String(name || '').trim()
  if (!label) throw invalid('A name is required.')
  await db().ssh_keys.updateMany({ where: { id }, data: { name: label, updated_at: Date.now() } })
  return getSshKey(id)
}

export const sshKeyGateways = async (id) => db().ssh_gateways.findMany({ where: { key_id: id }, select: { id: true, name: true } })

export const deleteSshKey = async (id) => db().ssh_keys.deleteMany({ where: { id } })

// ---- Gateways ----

export async function rowToSshGateway(row) {
  if (!row) return null
  const key = row.key_id ? await db().ssh_keys.findUnique({ where: { id: row.key_id }, select: { name: true } }) : null
  const secrets = sealed(row)
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    host: row.host,
    port: row.port || 22,
    username: row.username || '',
    auth: row.auth === 'password' ? 'password' : 'key',
    keyId: row.key_id || null,
    keyName: key?.name || null,
    hostFingerprint: row.host_fingerprint || null,
    hasPassword: !!secrets.password,
    transport: row.transport === 'cloudflare' ? 'cloudflare' : 'tcp',
    // The token's ID is an identifier (like an S3 access key ID) and is shown
    // so the form can say which token is set; its secret never leaves.
    serviceTokenId: secrets.cfClientId || '',
    hasServiceToken: !!secrets.cfClientSecret,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

const gatewayRow = async (id) => (id ? db().ssh_gateways.findUnique({ where: { id } }) : null)

export const getSshGateway = async (id) => rowToSshGateway(await gatewayRow(id))

export const listSshGateways = async (workspaceId) =>
  Promise.all(
    (await db().ssh_gateways.findMany({ where: { workspace_id: workspaceId }, orderBy: { created_at: 'asc' } })).map(rowToSshGateway)
  )

// Validate a gateway body against its workspace. A key from another workspace
// would be a way to borrow credentials the caller was never given.
async function gatewayFields(workspaceId, body, existing) {
  const name = String(body.name ?? existing?.name ?? '').trim()
  const host = String(body.host ?? existing?.host ?? '').trim()
  const username = String(body.username ?? existing?.username ?? '').trim()
  const port = parseInt(body.port ?? existing?.port ?? 22, 10)
  const auth = (body.auth ?? existing?.auth) === 'password' ? 'password' : 'key'
  const keyId = auth === 'key' ? body.keyId ?? existing?.keyId ?? null : null
  const transport = body.transport ?? existing?.transport ?? 'tcp'
  if (!TRANSPORTS.includes(transport)) throw invalid(`Unknown transport "${transport}".`)
  if (!name) throw invalid('A name is required.')
  if (!host) throw invalid('A host is required.')
  if (!username) throw invalid('A username is required.')
  if (!(port > 0 && port < 65536)) throw invalid('The port must be between 1 and 65535.')
  // Railway logs an unrecognised username into its interactive dev.new menu,
  // where nothing forwards; a private-network name is the usual mistake.
  if (host.toLowerCase() === RAILWAY_SSH_HOST && /\.railway\.internal$/i.test(username)) {
    throw invalid(`Railway doesn't accept a private-network name (${username}) as the SSH user — ${RAILWAY_USERNAME_HELP}.`)
  }
  if (auth === 'key') {
    const key = keyId && (await getSshKey(keyId))
    if (!key || key.workspaceId !== workspaceId) throw invalid('Pick one of this workspace\'s SSH keys.')
  }
  return { name, host, username, port, auth, keyId, transport }
}

// The sealed half of a gateway. Omitted secrets keep what is stored; an empty
// `serviceTokenId` clears the token. Only what the chosen auth and transport
// use is kept, so switching away from one doesn't leave its secret behind.
function gatewaySecrets(f, body, stored = {}) {
  const password = f.auth === 'password' ? body.password || stored.password : undefined
  if (f.auth === 'password' && !password) throw invalid('A password is required.')
  if (f.transport !== 'cloudflare') return { password }
  const cfClientId = body.serviceTokenId !== undefined ? String(body.serviceTokenId).trim() : stored.cfClientId
  // A stored secret belongs to its ID: a new ID needs its own secret.
  const keptSecret = cfClientId && cfClientId === stored.cfClientId ? stored.cfClientSecret : undefined
  const cfClientSecret = cfClientId ? body.serviceTokenSecret || keptSecret : undefined
  if (cfClientId && !cfClientSecret) throw invalid('Enter the service token secret.')
  return { password, cfClientId: cfClientId || undefined, cfClientSecret }
}

// The columns a gateway's validated fields map to — shared by create and update.
const gatewayColumns = (f, secrets) => ({
  name: f.name,
  host: f.host,
  port: f.port,
  username: f.username,
  auth: f.auth,
  key_id: f.keyId,
  transport: f.transport,
  credentials: seal(secrets),
})

export async function createSshGateway(workspaceId, body) {
  const f = await gatewayFields(workspaceId, body)
  const secrets = gatewaySecrets(f, body)
  const id = randomUUID()
  const now = Date.now()
  await db().ssh_gateways.create({
    data: { id, workspace_id: workspaceId, ...gatewayColumns(f, secrets), host_fingerprint: null, created_at: now, updated_at: now },
  })
  return getSshGateway(id)
}

/**
 * Update a gateway. A password or service token secret left out keeps the
 * stored one. Pointing it at a different host, port or transport forgets the
 * pinned host key (it belongs to the old server), and so does
 * `resetHostKey: true` — the way to accept a bastion that was legitimately
 * rebuilt.
 */
export async function updateSshGateway(id, body) {
  const row = await gatewayRow(id)
  const existing = await rowToSshGateway(row)
  const f = await gatewayFields(existing.workspaceId, body, existing)
  const secrets = gatewaySecrets(f, body, sealed(row))
  const moved = f.host !== existing.host || f.port !== existing.port || f.transport !== existing.transport
  const fingerprint = moved || body.resetHostKey ? null : existing.hostFingerprint
  await db().ssh_gateways.updateMany({
    where: { id },
    data: { ...gatewayColumns(f, secrets), host_fingerprint: fingerprint, updated_at: Date.now() },
  })
  return getSshGateway(id)
}

// Pin the host key on first contact. Leaves `updated_at` alone on purpose: the
// tunnel cache keys on it, and learning the key is not an edit to the gateway.
export const pinHostFingerprint = async (id, fingerprint) =>
  db().ssh_gateways.updateMany({ where: { id, host_fingerprint: null }, data: { host_fingerprint: fingerprint } })

export const deleteSshGateway = async (id) => db().ssh_gateways.deleteMany({ where: { id } })

// The connections that tunnel through a gateway — a gateway still in use can't
// be deleted, and editing one must drop those connections' open handles.
export const connectionsUsingGateway = async (id) => (await listConnections()).filter((c) => c.sshGatewayId === id)

/**
 * Is `gatewayId` something a connection in `workspaceId` may tunnel through?
 * Empty means "no tunnel" and is always fine; otherwise the gateway must exist
 * and belong to the same workspace. Throws a 400 naming the problem.
 */
export async function assertGatewayForWorkspace(gatewayId, workspaceId) {
  if (!gatewayId) return null
  const gateway = await getSshGateway(gatewayId)
  if (!gateway || gateway.workspaceId !== workspaceId) throw invalid('That SSH host is not part of this workspace.')
  return gateway
}

// ---- Connecting ----

// The ssh2 `connect()` options for a gateway: who to log in as and how.
export async function gatewayConnectConfig(gateway) {
  const base = { host: gateway.host, port: gateway.port || 22, username: gateway.username }
  if (gateway.auth === 'password') return { ...base, password: sealed(await gatewayRow(gateway.id)).password || '' }
  const secrets = sealed(await keyRow(gateway.keyId))
  if (!secrets.privateKey) throw Object.assign(new Error('The SSH key this SSH host uses no longer exists.'), { sshReason: true })
  return { ...base, privateKey: secrets.privateKey, passphrase: secrets.passphrase || undefined }
}

/**
 * Explain an SSH failure in the `{ cause, hint }` shape the connect dialog
 * renders. `phase` is what we were doing: logging in to the gateway, or asking
 * it to reach the database.
 */
export function explainSshError(error, gateway, phase = 'connect', target = '') {
  const cloudflare = gateway.transport === 'cloudflare'
  const where = cloudflare ? `${gateway.host} (via Cloudflare Access)` : `${gateway.host}:${gateway.port || 22}`
  const code = error?.code || ''
  // Never got as far as SSH: Cloudflare refused or couldn't reach the host.
  if (phase === 'transport') return explainAccessError(error, gateway.host)
  if (error?.hostKeyMismatch) {
    return {
      cause: `The SSH host ${where} presented a different host key than the one pinned (${gateway.hostFingerprint}).`,
      hint: 'If the host was rebuilt on purpose, forget the pinned host key in its settings (SSH → Host). Otherwise something may be intercepting the connection.',
    }
  }
  // Railway didn't recognise the username as a service and dropped the login
  // into its interactive dev.new menu, where forwarding waits for a human.
  if (phase === 'forward' && gateway.host === RAILWAY_SSH_HOST && /dev\.new|no box connected/i.test(error?.message || '')) {
    return {
      cause: `Railway found no service for "${gateway.username}", so it opened its interactive dev.new menu instead of a service's container — nothing can be forwarded from there.`,
      hint: `Edit the SSH host (SSH → Host) and ${RAILWAY_USERNAME_HELP}. To check a value, run ssh ${gateway.username}@${RAILWAY_SSH_HOST} in a terminal: the right one opens the service's shell, a wrong one shows Railway's menu with "No target found".`,
    }
  }
  if (phase === 'forward') {
    return {
      cause: `The SSH host ${where} could not reach ${target}${error?.message ? ` (${error.message})` : ''}.`,
      hint:
        gateway.host === RAILWAY_SSH_HOST
          ? `On Railway the address is resolved inside the service you log in as (${gateway.username}): 127.0.0.1 is that service's own container, so for a database in another service use its private-network name, e.g. postgres.railway.internal:5432.`
          : 'The database address is resolved from the SSH host, not from Tabletsgo — use the address the SSH host sees (a private IP, or 127.0.0.1 for a database on the SSH host itself), and check it allows TCP forwarding.',
    }
  }
  if (error?.level === 'client-authentication') {
    return {
      cause: `The SSH host ${where} rejected user "${gateway.username}".`,
      hint:
        gateway.host === RAILWAY_SSH_HOST
          ? `Register the key "${gateway.keyName || 'selected key'}"'s public key with Railway (railway ssh keys add, or your account's SSH keys), and check the user is the service's domain or instance ID.`
          : gateway.auth === 'key'
            ? `Add the key "${gateway.keyName || 'selected key'}"'s public key to ~${gateway.username}/.ssh/authorized_keys on the SSH host.`
            : 'Check the password, and that the SSH host allows password authentication.',
    }
  }
  if (error?.level === 'client-timeout' || code === 'ETIMEDOUT') {
    return { cause: `The SSH host ${where} did not answer in time.`, hint: 'Check that Tabletsgo is allowed to reach the SSH host on that port (firewall, security group, VPN).' }
  }
  if (code === 'ECONNREFUSED') {
    return { cause: `Nothing accepted an SSH connection on ${where}.`, hint: 'Check the SSH host address and port, and that sshd is running.' }
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { cause: `The SSH host name "${gateway.host}" could not be resolved.`, hint: 'Check the SSH host address for typos.' }
  }
  return { cause: `SSH host ${where}: ${error?.message || 'connection failed'}.`, hint: 'Open the SSH host (SSH → Host) and run "Test" to see the full error.' }
}

// An error the db layer's diagnosis recognises (`sshReason`), carrying the
// prose above so a handshake explains the tunnel rather than the database.
export function sshError(error, gateway, phase, target) {
  const { cause, hint } = explainSshError(error, gateway, phase, target)
  return Object.assign(new Error(cause), { sshReason: true, hint, code: error?.code, cause: error })
}

// The byte stream SSH runs over, for a transport that isn't plain TCP (ssh2
// dials host:port itself when there is none).
async function transportSocket(gateway) {
  if (gateway.transport !== 'cloudflare') return undefined
  const secrets = sealed(await gatewayRow(gateway.id))
  try {
    return await openAccessStream({
      hostname: gateway.host,
      clientId: secrets.cfClientId,
      clientSecret: secrets.cfClientSecret,
      timeoutMs: SSH_READY_TIMEOUT_MS,
    })
  } catch (error) {
    throw sshError(error, gateway, 'transport')
  }
}

/**
 * Open an SSH session to `gateway`, verifying (or pinning) its host key.
 * Resolves the ready ssh2 Client; rejects with an `sshError`.
 */
export async function connectGateway(gateway) {
  const config = await gatewayConnectConfig(gateway)
  const sock = await transportSocket(gateway)
  return new Promise((resolve, reject) => {
    const client = new Client()
    let mismatch = false
    let seen = null
    client
      .on('ready', () => {
        // Pinned before resolving, so whoever asked for the session (a test
        // reporting the key, a tunnel) reads the key it just learned.
        const pinning = seen && !gateway.hostFingerprint ? pinHostFingerprint(gateway.id, seen) : Promise.resolve()
        void pinning
          .catch((e) => console.error('Pinning the SSH host key failed:', e.message))
          .then(() => resolve(client))
      })
      .on('error', (error) => {
        sock?.destroy()
        if (mismatch) error.hostKeyMismatch = true
        reject(sshError(error, gateway, 'connect'))
      })
      .connect({
        ...config,
        ...(sock ? { sock } : {}),
        readyTimeout: SSH_READY_TIMEOUT_MS,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        hostVerifier: (key) => {
          seen = fingerprintOf(key)
          mismatch = !!gateway.hostFingerprint && gateway.hostFingerprint !== seen
          return !mismatch
        },
      })
  })
}

// Ask an open SSH connection to reach host:port, as a probe or for real.
export const forwardOut = (client, host, port) =>
  new Promise((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, host, Number(port), (error, stream) => (error ? reject(error) : resolve(stream)))
  })

// The gateway's own test: log in, report the host key. Never throws.
export async function testSshGateway(gateway) {
  let client
  try {
    client = await connectGateway(gateway)
    const pinned = (await getSshGateway(gateway.id))?.hostFingerprint
    return { ok: true, message: `Logged in to ${gateway.host} as ${gateway.username}.`, hostFingerprint: pinned }
  } catch (error) {
    return { ok: false, message: error.message, hint: error.hint }
  } finally {
    client?.end()
  }
}
