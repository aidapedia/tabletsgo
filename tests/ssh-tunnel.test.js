import assert from 'node:assert/strict'
import test from 'node:test'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ssh2 from 'ssh2'

// The meta handle is imported by every module below; give it an isolated DB,
// migrated before anything opens it (Prisma needs the file to itself).
process.env.ENCRYPTION_KEY = 'ssh-tunnel-test-key'
process.env.META_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tabletsgo-ssh-')), 'app.db')
const { runMigrations } = await import('../server/migrator/index.js')
runMigrations({ log: () => {} })
const { db: meta } = await import('../server/meta.js')
const ssh = await import('../server/ssh.js')
const db = await import('../server/db/index.js')
const { saveConnection } = await import('../server/connections.js')

const WS = 'ws-1'
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))

// A Redis-shaped target that answers just enough RESP for ioredis to connect
// and PING. It stands in for a database only the gateway can see.
function fakeRedis() {
  const server = net.createServer((socket) => {
    socket.on('data', (buf) => {
      for (const cmd of buf.toString().split('*').slice(1)) {
        const word = (cmd.split('\r\n')[2] || '').toUpperCase()
        if (word === 'PING') socket.write('+PONG\r\n')
        else if (word === 'INFO') {
          const body = 'redis_version:7.2.0\r\nloading:0\r\n'
          socket.write(`$${body.length}\r\n${body}\r\n`)
        } else socket.write('+OK\r\n')
      }
    })
  })
  return server
}

// An SSH bastion that accepts one public key and forwards direct-tcpip.
function fakeGateway(acceptedPublicKey) {
  const hostKey = ssh2.utils.generateKeyPairSync('ed25519').private
  const allowed = ssh2.utils.parseKey(acceptedPublicKey)
  const stats = { forwards: 0 }
  const server = new ssh2.Server({ hostKeys: [hostKey] }, (client) => {
    client
      .on('authentication', (ctx) => {
        const ok =
          ctx.method === 'publickey' &&
          ctx.key.algo === allowed.type &&
          Buffer.compare(ctx.key.data, allowed.getPublicSSH()) === 0 &&
          (!ctx.signature || allowed.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true)
        ok ? ctx.accept() : ctx.reject(['publickey'])
      })
      .on('ready', () => {
        client.on('tcpip', (accept, reject, info) => {
          const upstream = net.connect(info.destPort, info.destIP)
          upstream.once('error', () => reject())
          upstream.once('connect', () => {
            stats.forwards++
            const stream = accept()
            stream.pipe(upstream).pipe(stream)
            stream.on('close', () => upstream.destroy())
            upstream.on('close', () => stream.destroy())
          })
        })
      })
      .on('error', () => {})
  })
  return { server, stats }
}

test('a generated key exposes its public half and fingerprint, never the private key', async () => {
  const key = await ssh.createSshKey(WS, { name: 'Deploy key', mode: 'generate' }, 'u1')
  assert.match(key.publicKey, /^ssh-ed25519 AAAA\S+ Deploy-key$/)
  assert.match(key.fingerprint, /^SHA256:/)
  assert.equal(key.privateKey, undefined)
  assert.ok((await ssh.listSshKeys(WS)).some((k) => k.id === key.id))
})

test('importing a private key derives the same public key; a public key is refused', async () => {
  const pair = ssh2.utils.generateKeyPairSync('ed25519')
  const imported = await ssh.createSshKey(WS, { name: 'laptop', mode: 'import', privateKey: pair.private }, 'u1')
  assert.equal(imported.publicKey.split(' ')[1], pair.public.split(' ')[1])
  await assert.rejects(() => ssh.createSshKey(WS, { name: 'x', mode: 'import', privateKey: pair.public }), /public key/)
})

test('a gateway refuses a key from another workspace', async () => {
  const foreign = await ssh.createSshKey('ws-other', { name: 'theirs' }, 'u2')
  await assert.rejects(() => ssh.createSshGateway(WS, { name: 'g', host: 'h', username: 'u', auth: 'key', keyId: foreign.id }),
    /this workspace's SSH keys/
  )
})

test('a connection is reached through its SSH gateway', async (t) => {
  const key = await ssh.createSshKey(WS, { name: 'bastion' }, 'u1')
  const { server: gw, stats } = fakeGateway(key.publicKey)
  const target = fakeRedis()
  const gwPort = await listen(gw)
  const targetPort = await listen(target)
  t.after(() => {
    db.closeAllConnections()
    gw.close()
    target.close()
  })

  const gateway = await ssh.createSshGateway(WS, { name: 'Bastion', host: '127.0.0.1', port: gwPort, username: 'deploy', auth: 'key', keyId: key.id })

  // The gateway's own test logs in and pins the host key on first contact.
  const probe = await ssh.testSshGateway(gateway)
  assert.equal(probe.ok, true, probe.message)
  assert.match((await ssh.getSshGateway(gateway.id)).hostFingerprint, /^SHA256:/)

  const conn = { id: 'c1', type: 'redis', name: 'r', workspaceId: WS, host: '127.0.0.1', port: String(targetPort), auth: 'none', sshGatewayId: gateway.id }

  // Unsaved form → throwaway tunnel.
  const tested = await db.testConnection(conn)
  assert.equal(tested.ok, true, tested.message)

  // Saved connection → the generic ops and the engine's own ops both dial through it.
  await saveConnection(conn)
  const before = stats.forwards
  const shake = await db.handshake(conn, {})
  assert.equal(shake.ok, true, JSON.stringify(shake))
  const overview = await db.driverOps('redis').overview(conn, {})
  assert.ok(overview)
  assert.ok(stats.forwards > before, 'traffic went through the gateway')

  db.releaseConnection(conn)
})

test('tunnel failures are diagnosed as SSH, not blamed on the database', async (t) => {
  const key = await ssh.createSshKey(WS, { name: 'k2' }, 'u1')
  const other = await ssh.createSshKey(WS, { name: 'not-authorized' }, 'u1')
  const { server: gw } = fakeGateway(key.publicKey)
  const gwPort = await listen(gw)
  const closed = net.createServer()
  const deadPort = await listen(closed)
  closed.close()
  t.after(() => {
    db.closeAllConnections()
    gw.close()
  })

  // Wrong key: the gateway rejects the login.
  const wrongKey = await ssh.createSshGateway(WS, { name: 'wrong', host: '127.0.0.1', port: gwPort, username: 'deploy', auth: 'key', keyId: other.id })
  const rejected = await db.handshake({ id: 'c2', type: 'redis', host: '127.0.0.1', port: '6379', sshGatewayId: wrongKey.id }, {})
  assert.equal(rejected.reason, 'ssh')
  assert.match(rejected.cause, /rejected user "deploy"/)

  // Right key, but the gateway can't reach the database.
  const good = await ssh.createSshGateway(WS, { name: 'good', host: '127.0.0.1', port: gwPort, username: 'deploy', auth: 'key', keyId: key.id })
  const unreachable = await db.handshake({ id: 'c3', type: 'redis', host: '127.0.0.1', port: String(deadPort), sshGatewayId: good.id }, {})
  assert.equal(unreachable.reason, 'ssh')
  assert.match(unreachable.cause, /could not reach 127\.0\.0\.1:/)

  // A host key that no longer matches the pinned one is refused.
  await meta().ssh_gateways.update({ where: { id: good.id }, data: { host_fingerprint: 'SHA256:not-the-real-one' } })
  const swapped = await ssh.testSshGateway(await ssh.getSshGateway(good.id))
  assert.equal(swapped.ok, false)
  assert.match(swapped.message, /different host key/)
})

test('a gateway in use reports the connections using it', async () => {
  const key = await ssh.createSshKey(WS, { name: 'k3' }, 'u1')
  const gw = await ssh.createSshGateway(WS, { name: 'used', host: 'h', username: 'u', auth: 'key', keyId: key.id })
  await saveConnection({ id: 'c4', type: 'postgresql', name: 'pg', workspaceId: WS, host: 'db', port: '5432', sshGatewayId: gw.id })
  assert.deepEqual((await ssh.connectionsUsingGateway(gw.id)).map((c) => c.id), ['c4'])
  assert.deepEqual((await ssh.sshKeyGateways(key.id)).map((g) => g.id), [gw.id])
  assert.equal((await ssh.assertGatewayForWorkspace(gw.id, WS)).id, gw.id)
  await assert.rejects(() => ssh.assertGatewayForWorkspace(gw.id, 'ws-other'), /not part of this workspace/)
})

// ---- Cloudflare Access transport ----

const http = await import('node:http')
const { WebSocketServer, createWebSocketStream } = await import('ws')
const { accessUrl } = await import('../server/cloudflare-access.js')

// Stands in for Cloudflare's edge + cloudflared: an Access application that
// admits one service token and carries the WebSocket's bytes to the SSH port.
function fakeAccessEdge(sshPort, token) {
  const server = http.createServer()
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const id = req.headers['cf-access-client-id']
    const secret = req.headers['cf-access-client-secret']
    if (!id) {
      socket.end('HTTP/1.1 302 Found\r\nLocation: https://team.cloudflareaccess.com/cdn-cgi/access/login\r\nContent-Length: 0\r\n\r\n')
      return
    }
    if (id !== token.id || secret !== token.secret) {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const stream = createWebSocketStream(ws)
      const upstream = net.connect(sshPort, '127.0.0.1')
      stream.pipe(upstream).pipe(stream)
      stream.on('error', () => upstream.destroy())
      upstream.on('error', () => stream.destroy())
    })
  })
  return server
}

test('an Access hostname becomes wss://; plaintext is refused off loopback', async () => {
  assert.equal(accessUrl('ssh.example.com'), 'wss://ssh.example.com/')
  assert.equal(accessUrl('https://ssh.example.com'), 'wss://ssh.example.com/')
  assert.equal(accessUrl('ws://127.0.0.1:9000'), 'ws://127.0.0.1:9000/')
  assert.throws(() => accessUrl('ws://ssh.example.com'), /wss/)
})

test('a connection is reached through an SSH host behind Cloudflare Access', async (t) => {
  const key = await ssh.createSshKey(WS, { name: 'cf-key' }, 'u1')
  const { server: gw, stats } = fakeGateway(key.publicKey)
  const target = fakeRedis()
  const gwPort = await listen(gw)
  const targetPort = await listen(target)
  const token = { id: 'abc.access', secret: 's3cret' }
  const edge = fakeAccessEdge(gwPort, token)
  const edgePort = await listen(edge)
  t.after(() => {
    db.closeAllConnections()
    gw.close()
    target.close()
    edge.close()
  })

  const host = await ssh.createSshGateway(WS, {
    name: 'Behind CF', host: `ws://127.0.0.1:${edgePort}`, username: 'deploy', auth: 'key', keyId: key.id,
    transport: 'cloudflare', serviceTokenId: token.id, serviceTokenSecret: token.secret,
  })
  assert.equal(host.transport, 'cloudflare')
  assert.equal(host.serviceTokenId, token.id)
  assert.equal(host.hasServiceToken, true)
  assert.equal(JSON.stringify(host).includes(token.secret), false, 'the secret never leaves')

  const probe = await ssh.testSshGateway(host)
  assert.equal(probe.ok, true, probe.message)

  const conn = { id: 'cf1', type: 'redis', name: 'r', workspaceId: WS, host: '127.0.0.1', port: String(targetPort), auth: 'none', sshGatewayId: host.id }
  await saveConnection(conn)
  const shake = await db.handshake(conn, {})
  assert.equal(shake.ok, true, JSON.stringify(shake))
  assert.ok(stats.forwards > 0)

  // Renaming without re-entering the secret keeps it.
  const renamed = await ssh.updateSshGateway(host.id, { name: 'Behind CF (renamed)' })
  assert.equal(renamed.hasServiceToken, true)
  assert.equal((await ssh.testSshGateway(renamed)).ok, true)
})

test('Cloudflare Access refusals are explained as Cloudflare, not SSH or the database', async (t) => {
  const key = await ssh.createSshKey(WS, { name: 'cf-key-2' }, 'u1')
  const { server: gw } = fakeGateway(key.publicKey)
  const gwPort = await listen(gw)
  const edge = fakeAccessEdge(gwPort, { id: 'good', secret: 'good' })
  const edgePort = await listen(edge)
  t.after(() => {
    db.closeAllConnections()
    gw.close()
    edge.close()
  })
  const base = { host: `ws://127.0.0.1:${edgePort}`, username: 'deploy', auth: 'key', keyId: key.id, transport: 'cloudflare' }

  const wrong = await ssh.createSshGateway(WS, { ...base, name: 'wrong token', serviceTokenId: 'good', serviceTokenSecret: 'bad' })
  const refused = await db.handshake({ id: 'cf2', type: 'redis', host: 'db', port: '6379', sshGatewayId: wrong.id }, {})
  assert.equal(refused.reason, 'ssh')
  assert.match(refused.cause, /Cloudflare Access refused .* \(HTTP 403\)/)
  assert.match(refused.hint, /service token/)

  const none = await ssh.createSshGateway(WS, { ...base, name: 'no token' })
  const login = await ssh.testSshGateway(none)
  assert.equal(login.ok, false)
  assert.match(login.message, /HTTP 302/)
  assert.match(login.hint, /did not accept a service token/)

  await assert.rejects(() => ssh.createSshGateway(WS, { ...base, name: 'half', serviceTokenId: 'good' }), /service token secret/)
})

test('a rejected login on Railway points at Railway, not authorized_keys', async () => {
  const { hint } = ssh.explainSshError({ level: 'client-authentication' }, { host: 'ssh.railway.com', port: 22, username: 'app.up.railway.app', auth: 'key', keyName: 'k' })
  assert.match(hint, /Railway/)
})

test("a stored service token secret stays with its own ID", async () => {
  const key = await ssh.createSshKey(WS, { name: 'cf-key-3' }, 'u1')
  const host = await ssh.createSshGateway(WS, { name: 'cf', host: 'ssh.example.com', username: 'u', auth: 'key', keyId: key.id, transport: 'cloudflare', serviceTokenId: 'one', serviceTokenSecret: 'x' })
  assert.equal((await ssh.updateSshGateway(host.id, { serviceTokenId: 'one' })).hasServiceToken, true)
  await assert.rejects(() => ssh.updateSshGateway(host.id, { serviceTokenId: 'two' }), /service token secret/)
  // Back to direct TCP drops the token and forgets the pinned host key.
  await meta().ssh_gateways.update({ where: { id: host.id }, data: { host_fingerprint: 'SHA256:pinned' } })
  const direct = await ssh.updateSshGateway(host.id, { transport: 'tcp' })
  assert.equal(direct.hasServiceToken, false)
  assert.equal(direct.hostFingerprint, null)
})


test('Railway: a private-network username is refused, and its dev.new refusal is explained', async () => {
  const key = await ssh.createSshKey(WS, { name: 'railway' }, 'u1')
  await assert.rejects(() => ssh.createSshGateway(WS, { name: 'rw', host: 'ssh.railway.com', username: 'postgres-cxbl.railway.internal', auth: 'key', keyId: key.id }),
    /Copy Service Instance ID/
  )
  const gw = { host: 'ssh.railway.com', port: 22, username: 'postgres-cxbl.railway.internal', auth: 'key' }
  const lobby = { message: '(SSH) Channel open failure: port forwarding rides your dev.new session: run ssh -L ... dev.new with a shell or command, not -N' }
  const explained = ssh.explainSshError(lobby, gw, 'forward', '127.0.0.1:5432')
  assert.match(explained.cause, /found no service for "postgres-cxbl.railway.internal"/)
  assert.match(explained.hint, /Copy Service Instance ID.*not the Service ID/)
  assert.match(explained.hint, /No target found/)
  // A plain refusal on Railway still reads as an unreachable target.
  assert.match(ssh.explainSshError({ message: 'Connection refused' }, { ...gw, username: 'abc123' }, 'forward', 'x:1').cause, /could not reach/)
})
