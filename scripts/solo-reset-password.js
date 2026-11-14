/**
 * `npm run solo:reset-password [-- --password <new>]` — give a solo instance's
 * owner a new password, from a shell on the machine (or in the container):
 *
 *   docker compose exec tabletsgo npm run solo:reset-password
 *
 * Without --password it makes one up and prints it. Every session ends: the
 * owner signs in again with the new password. Whoever can run this already
 * holds the data volume, so it asks for nothing else.
 */
import { randomBytes } from 'crypto'
import { openMeta } from '../server/meta-connection.js'
import { hashPassword } from '../server/crypto.js'
import { SOLO_KEY, readSetting, writeSetting } from '../server/migrator/identity.js'

const at = process.argv.indexOf('--password')
const password = at > 0 ? process.argv[at + 1] || '' : randomBytes(12).toString('base64url')
if (password.length < 8) {
  console.error('❌ Use at least 8 characters for the password.')
  process.exit(1)
}

const db = openMeta()
try {
  const solo = readSetting(db, SOLO_KEY)
  if (!solo?.owner) {
    console.error('❌ This instance has no solo owner yet (or runs in enterprise mode, where Hayat resets passwords). Open it in a browser to set it up.')
    process.exit(1)
  }
  writeSetting(db, SOLO_KEY, {
    ...solo,
    owner: { ...solo.owner, passwordHash: await hashPassword(password) },
    tokenEpoch: (solo.tokenEpoch || 0) + 1,
  })
  console.log(`✅ New password for ${solo.owner.email}: ${password}`)
  console.log('   Every session has ended. Sign in again with it, then change it under Settings → Account.')
} finally {
  db.close()
}
