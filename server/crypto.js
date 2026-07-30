/**
 * At-rest encryption. Every secret the app stores is sealed with AES-256-GCM
 * under a key derived from ENCRYPTION_KEY. Each kind of secret gets its own
 * scrypt salt, so a key that leaks from one namespace can't open another.
 */

import fs from 'fs'
import { pipeline } from 'stream/promises'
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto'
import { ENCRYPTION_KEY } from './config.js'

export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex')

// Connection credentials (host/port/username/password/…).
export const CRED_KEY = scryptSync(ENCRYPTION_KEY, 'tabletsgo-connections', 32)
// Storage destination credentials (S3 access/secret keys).
export const STORAGE_CRED_KEY = scryptSync(ENCRYPTION_KEY, 'tabletsgo-storage', 32)
// Optional at-rest encryption for backup files before upload.
export const BACKUP_FILE_KEY = scryptSync(ENCRYPTION_KEY, 'tabletsgo-backup-file', 32)

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
