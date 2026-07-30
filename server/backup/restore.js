/**
 * Restore — pull a stored artifact back down and overwrite a live database.
 *
 * Three entry points reach here (a recorded backup run, a browsed storage
 * object, an uploaded file) and they all end in the same two steps: decrypt if
 * the artifact was encrypted with this server's key, then hand the file to the
 * connection's driver. Temp files are cleaned up on every path.
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { BACKUP_TMP_DIR } from '../config.js'
import { decryptFileToFile } from '../crypto.js'
import { restoreDatabaseFromFile, supports } from '../db/index.js'
import { fetchObjectToFile, getStorage, isSafeLocalKey } from '../storage.js'

// Can a backup be restored *into* this connection at all?
export const canRestore = (conn) => supports(conn, 'restore')

// A storage destination this connection may restore from: the built-in local
// disk, or an S3 destination belonging to the connection's workspace.
export function storageForRestore(conn, destinationId) {
  const dest = destinationId ? getStorage(destinationId) : null
  if (!dest) return null
  if (!dest.local && dest.workspaceId !== conn.workspaceId) return null
  return dest
}

const tmpPath = (suffix) => path.join(BACKUP_TMP_DIR, `${randomUUID()}-${suffix}`)

// Fetch a stored object into a local file, decrypting it when needed. The caller
// owns the returned file and must call `cleanup()` when done with it — used by
// the download route, which has to keep the file alive until the response ends.
export async function fetchArtifact(dest, key, { encrypted = false } = {}) {
  const downloaded = tmpPath('dl')
  let decrypted = null
  const cleanup = () => {
    fs.rm(downloaded, { force: true }, () => {})
    if (decrypted) fs.rm(decrypted, { force: true }, () => {})
  }
  try {
    await fetchObjectToFile(dest, key, downloaded)
    const filePath = encrypted ? (decrypted = await decryptFileToFile(downloaded)) : downloaded
    return { filePath, cleanup }
  } catch (err) {
    cleanup()
    throw err
  }
}

// Restore from an object in a storage destination.
export async function restoreFromStorage(conn, dest, key, { encrypted = false } = {}) {
  if (dest.local && !isSafeLocalKey(key)) throw Object.assign(new Error('Invalid object key'), { status: 400 })
  const { filePath, cleanup } = await fetchArtifact(dest, key, { encrypted })
  try {
    await restoreDatabaseFromFile(conn, filePath)
  } finally {
    cleanup()
  }
}

// Restore from a file already on this server's disk (an upload). The source file
// belongs to the caller; only the decrypted copy is cleaned up here.
export async function restoreFromFile(conn, filePath, { encrypted = false } = {}) {
  let decrypted = null
  try {
    const dumpPath = encrypted ? (decrypted = await decryptFileToFile(filePath)) : filePath
    await restoreDatabaseFromFile(conn, dumpPath)
  } finally {
    if (decrypted) fs.rm(decrypted, { force: true }, () => {})
  }
}
