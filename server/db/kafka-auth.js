/**
 * How a Kafka connection proves who it is, beyond a username and password:
 * client certificates (mTLS) and the SASL mechanisms that need more than
 * kafkajs's built-ins — OAUTHBEARER with a client-credentials token, and
 * AWS_MSK_IAM (Amazon MSK's IAM access control).
 *
 * Record fields, reusing the existing ones where the concept maps:
 *   clientCertFormat   '' | 'pem' | 'pkcs12'
 *   clientCert         PEM certificate chain              (pem)
 *   clientKey          PEM private key — a secret         (pem)
 *   clientPfx          base64 PKCS#12 bundle — a secret   (pkcs12)
 *   clientKeyPassphrase  the key's / bundle's passphrase — a secret
 *   OAUTHBEARER: username = client id, password = client secret,
 *                oauthTokenUrl, oauthScope, oauthExtensions ("key=value" lines)
 *   AWS_MSK_IAM: username = access key id, password = secret access key,
 *                awsSessionToken (a secret), awsRegion (else read from the broker host)
 */

import { createHash, createHmac } from 'crypto'

// ---- Client certificates ----------------------------------------------------------

/** The TLS options that present a client certificate, or {} when there is none. */
export function clientCertOf(conn) {
  const passphrase = conn.clientKeyPassphrase || undefined
  if (conn.clientCertFormat === 'pkcs12') {
    if (!conn.clientPfx) throw Object.assign(new Error('Choose the PKCS#12 (.p12 / .pfx) file for the client certificate.'), { status: 400 })
    return { pfx: Buffer.from(conn.clientPfx, 'base64'), passphrase }
  }
  if (conn.clientCertFormat === 'pem') {
    if (!conn.clientCert?.trim() || !conn.clientKey?.trim()) {
      throw Object.assign(new Error('A client certificate needs both the certificate and its private key (PEM).'), { status: 400 })
    }
    return { cert: conn.clientCert, key: conn.clientKey, passphrase }
  }
  return {}
}

// ---- OAUTHBEARER ----------------------------------------------------------------------

// "key=value" per line (or comma-separated) → the SASL extensions object.
// Confluent Cloud needs `logicalCluster` and `identityPoolId` here.
export function parseExtensions(text) {
  const out = {}
  for (const part of String(text || '').split(/[\n,]+/)) {
    const at = part.indexOf('=')
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim()
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * A token provider for the OAuth 2.0 client-credentials grant. A token is
 * reused until a minute before it expires — kafkajs asks for one on every new
 * broker connection, and a burst of connections must not be a burst of logins.
 */
export function oauthBearerProvider(conn) {
  const url = conn.oauthTokenUrl?.trim()
  if (!url) throw Object.assign(new Error('OAUTHBEARER needs the token endpoint URL of your identity provider.'), { status: 400 })
  const extensions = parseExtensions(conn.oauthExtensions)
  let cached = null
  return async () => {
    if (cached && cached.expiresAt > Date.now() + 60000) return cached.token
    const body = new URLSearchParams({ grant_type: 'client_credentials' })
    if (conn.oauthScope?.trim()) body.set('scope', conn.oauthScope.trim())
    const basic = Buffer.from(`${encodeURIComponent(conn.username || '')}:${encodeURIComponent(conn.password || '')}`).toString('base64')
    let res
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', authorization: `Basic ${basic}` },
        body,
        signal: AbortSignal.timeout(10000),
      })
    } catch (error) {
      throw Object.assign(new Error(`SASL OAUTHBEARER: the token endpoint ${url} could not be reached (${error.cause?.code || error.message}).`), { name: 'KafkaJSSASLAuthenticationError' })
    }
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.access_token) {
      const why = json.error_description || json.error || `HTTP ${res.status}`
      throw Object.assign(new Error(`SASL OAUTHBEARER: the token endpoint refused the client credentials (${why}).`), { name: 'KafkaJSSASLAuthenticationError' })
    }
    const token = { value: json.access_token, ...(extensions ? { extensions } : {}) }
    cached = { token, expiresAt: Date.now() + (Number(json.expires_in) || 300) * 1000 }
    return token
  }
}

// ---- AWS_MSK_IAM ---------------------------------------------------------------------

const sha256 = (data) => createHash('sha256').update(data, 'utf8').digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data, 'utf8').digest()
// RFC 3986 — what SigV4's canonical query string wants, stricter than encodeURIComponent.
const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** `b-1.mycluster.abc123.c2.kafka.eu-west-1.amazonaws.com` → `eu-west-1`. */
export function awsRegionOf(host) {
  return /\.kafka(?:-serverless)?\.([a-z0-9-]+)\.amazonaws\.com$/i.exec(String(host || ''))?.[1] || null
}

/**
 * The AWS_MSK_IAM initial response: a SigV4 presigned `kafka-cluster:Connect`
 * request for the broker being logged into, as JSON. This is what Amazon's
 * aws-msk-iam-auth library sends; signing it here keeps the AWS SDK out.
 */
export function mskIamPayload({ host, region, accessKeyId, secretAccessKey, sessionToken, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const day = amzDate.slice(0, 8)
  const scope = `${day}/${region}/kafka-cluster/aws4_request`
  const query = {
    Action: 'kafka-cluster:Connect',
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': '900',
    ...(sessionToken ? { 'X-Amz-Security-Token': sessionToken } : {}),
    'X-Amz-SignedHeaders': 'host',
  }
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(query[k])}`)
    .join('&')
  const canonicalRequest = ['GET', '/', canonicalQuery, `host:${host}`, '', 'host', sha256('')].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
  const key = ['kafka-cluster', 'aws4_request'].reduce(hmac, hmac(hmac(`AWS4${secretAccessKey}`, day), region))
  const signature = createHmac('sha256', key).update(toSign, 'utf8').digest('hex')
  return {
    version: '2020_10_22',
    host,
    'user-agent': 'tabletsgo',
    action: 'kafka-cluster:Connect',
    'x-amz-algorithm': 'AWS4-HMAC-SHA256',
    'x-amz-credential': query['X-Amz-Credential'],
    'x-amz-date': amzDate,
    'x-amz-signedheaders': 'host',
    'x-amz-expires': '900',
    ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}),
    'x-amz-signature': signature,
  }
}

/** kafkajs's custom-mechanism hook for AWS_MSK_IAM: one signed request per broker login. */
export function mskIamProvider(conn) {
  if (!conn.username || !conn.password) {
    throw Object.assign(new Error('AWS_MSK_IAM needs an access key ID (user) and secret access key (password).'), { status: 400 })
  }
  return ({ host, saslAuthenticate }) => ({
    authenticate: async () => {
      const region = conn.awsRegion?.trim() || awsRegionOf(host)
      if (!region) {
        throw Object.assign(new Error(`SASL AWS_MSK_IAM: can't tell the AWS region from "${host}" — set it on the connection.`), { name: 'KafkaJSSASLAuthenticationError' })
      }
      const payload = mskIamPayload({ host, region, accessKeyId: conn.username, secretAccessKey: conn.password, sessionToken: conn.awsSessionToken || undefined })
      // SASL bytes go on the wire length-prefixed (Kafka's BYTES), as kafkajs's own mechanisms write them.
      const bytes = Buffer.from(JSON.stringify(payload))
      const framed = Buffer.concat([Buffer.alloc(4), bytes])
      framed.writeInt32BE(bytes.length, 0)
      await saslAuthenticate({
        request: { encode: () => framed },
        response: { decode: (raw) => raw, parse: (raw) => raw },
      })
    },
  })
}
