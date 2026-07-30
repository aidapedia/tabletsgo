/**
 * Storage destinations — where backups are written.
 *
 * A destination is either an S3-compatible bucket (AWS S3, MinIO, R2, B2, …)
 * belonging to a workspace, or the reserved built-in "local server disk". Both
 * flow through the same pipeline (store, prune, list, download, delete); each
 * step branches on `dest.local` instead of talking to S3.
 *
 * Same storage split as connections: dialect-agnostic fields are plain columns,
 * the access/secret key pair is encrypted into `credentials` (with its own key).
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { pipeline } from 'stream/promises'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'
import { LOCAL_BACKUP_DIR } from './config.js'
import { meta } from './meta.js'
import { STORAGE_CRED_KEY, decryptSecret, encryptFileToFile, encryptSecret } from './crypto.js'
import { describeError, safeJson, sanitizeForKey } from './util.js'

// The reserved id of the built-in local-disk destination — the default when a
// connection's backup schedule has no S3 destination configured.
export const LOCAL_STORAGE_ID = 'local'

export function rowToStorage(row) {
  if (!row) return null
  let credentials = {}
  if (row.credentials) {
    try {
      credentials = JSON.parse(decryptSecret(row.credentials, STORAGE_CRED_KEY))
    } catch {
      credentials = {}
    }
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    endpoint: row.endpoint || '',
    region: row.region || '',
    bucket: row.bucket,
    pathPrefix: row.path_prefix || '',
    forcePathStyle: !!row.force_path_style,
    accessKeyId: credentials.accessKeyId || '',
    secretAccessKey: credentials.secretAccessKey || '',
    sessionToken: credentials.sessionToken || undefined,
  }
}

const localStorageDest = () => ({
  id: LOCAL_STORAGE_ID,
  workspaceId: null,
  name: 'Local server disk',
  local: true,
  endpoint: '',
  region: '',
  bucket: '',
  pathPrefix: '',
  forcePathStyle: false,
  accessKeyId: '',
  secretAccessKey: '',
})

export const getStorage = (id) =>
  id === LOCAL_STORAGE_ID
    ? localStorageDest()
    : rowToStorage(meta.prepare('SELECT * FROM storage_destinations WHERE id = ?').get(id))

export const listStorageRows = (workspaceId) =>
  meta.prepare('SELECT * FROM storage_destinations WHERE workspace_id = ? ORDER BY created_at').all(workspaceId).map(rowToStorage)

const packCredentials = (dest) =>
  encryptSecret(
    JSON.stringify({ accessKeyId: dest.accessKeyId, secretAccessKey: dest.secretAccessKey, sessionToken: dest.sessionToken }),
    STORAGE_CRED_KEY
  )

export function createStorage(workspaceId, body) {
  const id = randomUUID()
  const now = Date.now()
  meta
    .prepare(
      `INSERT INTO storage_destinations
       (id, workspace_id, name, endpoint, region, bucket, path_prefix, force_path_style, credentials, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      workspaceId,
      body.name.trim(),
      body.endpoint?.trim() || null,
      body.region?.trim() || null,
      body.bucket.trim(),
      body.pathPrefix?.trim() || null,
      body.forcePathStyle ? 1 : 0,
      packCredentials(body),
      now,
      now
    )
  return getStorage(id)
}

// `merged` is the existing destination with the request body layered on top, so
// a partial update keeps the fields it didn't mention.
export function updateStorage(id, merged) {
  meta
    .prepare(
      `UPDATE storage_destinations
       SET name = ?, endpoint = ?, region = ?, bucket = ?, path_prefix = ?, force_path_style = ?, credentials = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      merged.name.trim(),
      merged.endpoint?.trim() || null,
      merged.region?.trim() || null,
      merged.bucket.trim(),
      merged.pathPrefix?.trim() || null,
      merged.forcePathStyle ? 1 : 0,
      packCredentials(merged),
      Date.now(),
      id
    )
  forgetS3Client(id) // credentials/endpoint may have changed
  return getStorage(id)
}

export function deleteStorage(id) {
  meta.prepare('DELETE FROM storage_destinations WHERE id = ?').run(id)
  forgetS3Client(id)
}

// True when a workflow's graph still references this destination from a
// `storage` node — deleting it out from under a scheduled backup would fail
// silently at run time otherwise.
export const isStorageInUse = (id) =>
  meta
    .prepare('SELECT graph FROM workflows')
    .all()
    .some((w) => (safeJson(w.graph)?.nodes || []).some((n) => n.type === 'storage' && (n.data?.destinationIds || []).includes(id)))

// S3 client per destination id, so repeated uploads (e.g. within one backup run)
// reuse the same client. Dropped when the destination's config changes.
const s3Clients = new Map()

function getS3Client(dest) {
  if (!s3Clients.has(dest.id)) {
    s3Clients.set(
      dest.id,
      new S3Client({
        endpoint: dest.endpoint || undefined,
        region: dest.region || 'us-east-1',
        forcePathStyle: !!dest.forcePathStyle,
        credentials: {
          accessKeyId: dest.accessKeyId,
          secretAccessKey: dest.secretAccessKey,
          sessionToken: dest.sessionToken,
        },
      })
    )
  }
  return s3Clients.get(dest.id)
}

export const forgetS3Client = (id) => s3Clients.delete(id)

// Reachability probe for the destination's bucket.
export async function testStorage(dest) {
  try {
    await getS3Client(dest).send(new HeadBucketCommand({ Bucket: dest.bucket }))
    return { ok: true, message: `Connected! Bucket "${dest.bucket}" is reachable.` }
  } catch (error) {
    return { ok: false, message: describeError(error) }
  }
}

// A local object key must resolve inside LOCAL_BACKUP_DIR — no path traversal.
export const isSafeLocalKey = (key) =>
  path.resolve(LOCAL_BACKUP_DIR, key).startsWith(LOCAL_BACKUP_DIR + path.sep)

// ---- Object operations -----------------------------------------------------

// Uploads a file (from an upstream node's { filePath } output) to one or more
// storage destinations, streaming so the file is never buffered in memory.
// `opts.encrypt` encrypts the file with a server-derived key before upload;
// `opts.retentionDays` prunes older objects under the same key prefix after a
// successful upload (0/undefined = never delete).
//
// Never throws for a failed destination: it records a per-destination
// `ok: false` instead, so one bad destination doesn't hide another's successful
// key. Callers decide whether that counts as a failed run.
export async function storeFile(conn, input, destinationIds, opts = {}) {
  if (!destinationIds?.length) throw new Error('No storage destinations selected')
  const dateStr = new Date().toISOString().slice(0, 10)
  const uploaded = []
  let uploadPath = input.filePath
  let cleanupEncrypted = false
  if (opts.encrypt) {
    uploadPath = await encryptFileToFile(input.filePath)
    cleanupEncrypted = true
  }
  try {
    for (const destId of destinationIds) {
      const dest = getStorage(destId)
      if (!dest) {
        uploaded.push({ destinationId: destId, ok: false, error: 'Storage destination not found' })
        continue
      }
      const prefix = dest.pathPrefix ? `${dest.pathPrefix.replace(/^\/+|\/+$/g, '')}/` : ''
      const folder = `${prefix}${sanitizeForKey(conn.name)}/`
      try {
        const key = `${folder}${dateStr}/${path.basename(input.filePath)}${opts.encrypt ? '.enc' : ''}`
        if (dest.local) {
          const absPath = path.join(LOCAL_BACKUP_DIR, key)
          fs.mkdirSync(path.dirname(absPath), { recursive: true })
          await fs.promises.copyFile(uploadPath, absPath)
        } else {
          await getS3Client(dest).send(
            new PutObjectCommand({ Bucket: dest.bucket, Key: key, Body: fs.createReadStream(uploadPath) })
          )
        }
        const entry = { destinationId: destId, ok: true, key, sizeBytes: input.sizeBytes }
        if (opts.encrypt) entry.encrypted = true
        if (opts.retentionDays > 0) {
          try {
            entry.prunedCount = await pruneOldBackups(dest, folder, opts.retentionDays)
          } catch (err) {
            entry.pruneError = describeError(err)
          }
        }
        uploaded.push(entry)
      } catch (err) {
        uploaded.push({ destinationId: destId, ok: false, error: describeError(err) })
      }
    }
  } finally {
    if (cleanupEncrypted) fs.rm(uploadPath, { force: true }, () => {})
  }
  return { uploaded }
}

// Reads a stored object (S3 or local disk) into a local temp file. Shared by
// download/restore so neither has to know which kind of destination it is.
export async function fetchObjectToFile(dest, key, destPath) {
  if (dest.local) {
    await fs.promises.copyFile(path.join(LOCAL_BACKUP_DIR, key), destPath)
  } else {
    const obj = await getS3Client(dest).send(new GetObjectCommand({ Bucket: dest.bucket, Key: key }))
    await pipeline(obj.Body, fs.createWriteStream(destPath))
  }
}

// Lists a destination's stored files (newest first, capped) so the
// restore-from-storage picker can browse what's actually in the bucket/folder.
export async function listObjects(dest, limit = 500) {
  const objects = []
  if (dest.local) {
    const walk = (dir, rel) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const key = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.isDirectory()) walk(path.join(dir, entry.name), key)
        else {
          const st = fs.statSync(path.join(dir, entry.name))
          objects.push({ key, sizeBytes: st.size, lastModified: Math.round(st.mtimeMs) })
        }
      }
    }
    walk(LOCAL_BACKUP_DIR, '')
  } else {
    const client = getS3Client(dest)
    const prefix = dest.pathPrefix ? `${dest.pathPrefix.replace(/^\/+|\/+$/g, '')}/` : ''
    let ContinuationToken
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: dest.bucket, Prefix: prefix, ContinuationToken }))
      for (const obj of page.Contents || []) {
        if (obj.Key && !obj.Key.endsWith('/'))
          objects.push({ key: obj.Key, sizeBytes: obj.Size ?? 0, lastModified: obj.LastModified ? new Date(obj.LastModified).getTime() : null })
      }
      ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (ContinuationToken && objects.length < 5000)
  }
  objects.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0))
  return objects.slice(0, limit)
}

// Deletes stored objects (S3 or local disk) by key.
export async function deleteObjects(dest, keys) {
  if (!keys.length) return
  if (dest.local) {
    for (const key of keys) fs.rmSync(path.join(LOCAL_BACKUP_DIR, key), { force: true })
  } else {
    await getS3Client(dest).send(new DeleteObjectsCommand({ Bucket: dest.bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }))
  }
}

// Deletes objects under `folder` older than `retentionDays`. Scoped to this
// connection's own backup prefix — never touches anything outside it.
export async function pruneOldBackups(dest, folder, retentionDays) {
  const cutoff = Date.now() - retentionDays * 86400000
  if (dest.local) return pruneLocalBackups(folder, cutoff)
  const client = getS3Client(dest)
  const stale = []
  let ContinuationToken
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: dest.bucket, Prefix: folder, ContinuationToken }))
    for (const obj of page.Contents || []) {
      if (obj.Key && obj.LastModified && new Date(obj.LastModified).getTime() < cutoff) stale.push({ Key: obj.Key })
    }
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (ContinuationToken)
  if (!stale.length) return 0
  // S3 caps a single batch delete at 1000 keys.
  for (let i = 0; i < stale.length; i += 1000) {
    await client.send(new DeleteObjectsCommand({ Bucket: dest.bucket, Delete: { Objects: stale.slice(i, i + 1000) } }))
  }
  return stale.length
}

// Deletes local-disk backups under `folder` older than the cutoff. Layout
// mirrors the S3 keys: <folder>/<date>/<file>.
function pruneLocalBackups(folder, cutoff) {
  const root = path.join(LOCAL_BACKUP_DIR, folder)
  if (!fs.existsSync(root)) return 0
  let removed = 0
  for (const dateDir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dateDir.isDirectory()) continue
    const dirPath = path.join(root, dateDir.name)
    for (const file of fs.readdirSync(dirPath)) {
      const filePath = path.join(dirPath, file)
      if (fs.statSync(filePath).mtimeMs < cutoff) {
        fs.rmSync(filePath, { force: true })
        removed++
      }
    }
    if (fs.readdirSync(dirPath).length === 0) fs.rmSync(dirPath, { recursive: true, force: true })
  }
  return removed
}
