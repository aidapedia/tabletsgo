/**
 * At-rest encryption. Every secret the app stores is sealed with AES-256-GCM
 * under a key derived from ENCRYPTION_KEY. Each kind of secret gets its own
 * scrypt salt, so a key that leaks from one namespace can't open another.
 */

import fs from 'fs'
import { pipeline } from 'stream/promises'
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'crypto'
import { ENCRYPTION_KEY } from './config.js'

export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex')

// Connection credentials (host/port/username/password/…).
export const CRED_KEY = scryptSync(ENCRYPTION_KEY, 'tabletsgo-connections', 32)
// Storage destination credentials (S3 access/secret keys).
export const STORAGE_CRED_KEY = scryptSync(ENCRYPTION_KEY, 'tabletsgo-storage', 32)
// Optional at-rest encryption for backup files before upload.
export const BACKUP_FILE_KEY = scryptSync(ENCRYPTION_KEY, 'tabletsgo-backup-file', 32)
// Secrets inside instance-wide settings (the global SMTP password).
export const APP_SETTINGS_KEY = scryptSync(ENCRYPTION_KEY, 'tabletsgo-app-settings', 32)
// SSH secrets: a key's private half + passphrase, a gateway's password.
export const SSH_CRED_KEY = scryptSync(ENCRYPTION_KEY, 'tabletsgo-ssh', 32)
// Signs the solo owner's session tokens (server/solo.js). Not a cipher key: an
// HMAC secret, in its own namespace like the rest.
export const SOLO_SESSION_KEY = scryptSync(ENCRYPTION_KEY, 'tabletsgo-solo-session', 32)

// ---- Passwords (solo mode's one owner) ----
// scrypt from Node itself, so no native dependency: `$scrypt$N$r$p$salt$hash`.
// `$sha256$<hex>` is a v1.0 account's unsalted hash, carried over once and
// replaced on the first sign-in (the caller sees `legacy: true`).
const SCRYPT = { N: 16384, r: 8, p: 1 }
const scryptAsync = (password, salt, len, opts) =>
  new Promise((resolve, reject) => scrypt(password, salt, len, opts, (e, key) => (e ? reject(e) : resolve(key))))

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = await scryptAsync(String(password), salt, 32, SCRYPT)
  return `$scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${hash.toString('hex')}`
}

/** → { ok, legacy }. Never throws on a malformed hash: it just doesn't match. */
export async function verifyPassword(password, stored) {
  const value = String(stored || '')
  const same = (a, b) => a.length === b.length && timingSafeEqual(a, b)
  if (value.startsWith('$sha256$')) {
    const ok = same(Buffer.from(sha256(password)), Buffer.from(value.slice(8)))
    return { ok, legacy: ok }
  }
  const [, kind, N, r, p, salt, hash] = value.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return { ok: false, legacy: false }
  const got = await scryptAsync(String(password), Buffer.from(salt, 'hex'), 32, { N: +N, r: +r, p: +p })
  return { ok: same(got, Buffer.from(hash, 'hex')), legacy: false }
}

export function encryptSecret(plaintext, key = CRED_KEY) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`
}

export function decryptSecret(payload, key = CRED_KEY) {
  if (!payload) return ''
  const [ivHex, tagHex, dataHex] = payload.split(':')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
}

// On-disk format for an encrypted backup file: [12B IV][ciphertext][16B authTag].
// Streamed both ways so file size never buffers fully in memory.
export async function encryptFileToFile(srcPath, key = BACKUP_FILE_KEY) {
  const destPath = `${srcPath}.enc`
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const out = fs.createWriteStream(destPath)
  await new Promise((resolve, reject) => out.write(iv, (err) => (err ? reject(err) : resolve())))
  await pipeline(fs.createReadStream(srcPath), cipher, out) // ends `out` once the cipher finishes
  await fs.promises.appendFile(destPath, cipher.getAuthTag())
  return destPath
}

export async function decryptFileToFile(srcPath, key = BACKUP_FILE_KEY) {
  const destPath = `${srcPath}.dec`
  const size = fs.statSync(srcPath).size
  const ivBuf = Buffer.alloc(12)
  const fd = fs.openSync(srcPath, 'r')
  fs.readSync(fd, ivBuf, 0, 12, 0)
  const tagBuf = Buffer.alloc(16)
  fs.readSync(fd, tagBuf, 0, 16, size - 16)
  fs.closeSync(fd)
  const decipher = createDecipheriv('aes-256-gcm', key, ivBuf)
  decipher.setAuthTag(tagBuf)
  await pipeline(fs.createReadStream(srcPath, { start: 12, end: size - 17 }), decipher, fs.createWriteStream(destPath))
  return destPath
}
