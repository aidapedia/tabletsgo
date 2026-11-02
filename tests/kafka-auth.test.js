import assert from 'node:assert/strict'
import test from 'node:test'
import { awsRegionOf, clientCertOf, mskIamPayload, parseExtensions } from '../server/db/kafka-auth.js'

// Kafka sign-in beyond username/password: client certificates, OAUTHBEARER's
// extensions and the AWS_MSK_IAM signature. Pure — no broker needed.

test('the AWS region is read from an MSK broker address', () => {
  assert.equal(awsRegionOf('b-1.demo.abc123.c2.kafka.eu-west-1.amazonaws.com'), 'eu-west-1')
  assert.equal(awsRegionOf('boot-abc.c1.kafka-serverless.us-east-2.amazonaws.com'), 'us-east-2')
  assert.equal(awsRegionOf('localhost'), null)
})

// Signed by @smithy/signature-v4's presign for the same request, time and keys.
test('the AWS_MSK_IAM payload carries a SigV4 presigned kafka-cluster:Connect', () => {
  const p = mskIamPayload({
    host: 'b-1.demo.abc123.c2.kafka.eu-west-1.amazonaws.com',
    region: 'eu-west-1',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    sessionToken: 'tok/en+=',
    now: new Date('2026-11-01T10:20:30Z'),
  })
  assert.equal(p['x-amz-signature'], '1558806c666745d2333350481de6c46ddcf803638cc6c6f86964a200b9258fcf')
  assert.equal(p['x-amz-credential'], 'AKIDEXAMPLE/20261101/eu-west-1/kafka-cluster/aws4_request')
  assert.equal(p['x-amz-date'], '20261101T102030Z')
  assert.equal(p['x-amz-security-token'], 'tok/en+=')
  assert.equal(p.action, 'kafka-cluster:Connect')
})

test('OAUTHBEARER extensions parse from lines or commas', () => {
  assert.deepEqual(parseExtensions('logicalCluster=lkc-1\nidentityPoolId = pool-2'), { logicalCluster: 'lkc-1', identityPoolId: 'pool-2' })
  assert.deepEqual(parseExtensions('a=1,b=x=y'), { a: '1', b: 'x=y' })
  assert.equal(parseExtensions(''), undefined)
})

test('a client certificate becomes TLS options, and an incomplete one is refused', () => {
  assert.deepEqual(clientCertOf({}), {})
  assert.deepEqual(clientCertOf({ clientCertFormat: 'pem', clientCert: 'C', clientKey: 'K', clientKeyPassphrase: 'p' }), { cert: 'C', key: 'K', passphrase: 'p' })
  const pfx = clientCertOf({ clientCertFormat: 'pkcs12', clientPfx: Buffer.from('bundle').toString('base64') })
  assert.equal(pfx.pfx.toString(), 'bundle')
  assert.throws(() => clientCertOf({ clientCertFormat: 'pem', clientCert: 'C' }), { status: 400 })
  assert.throws(() => clientCertOf({ clientCertFormat: 'pkcs12' }), { status: 400 })
})
