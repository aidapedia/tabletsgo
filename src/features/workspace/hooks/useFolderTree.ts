import { useState } from 'react'

export type Folder = { id: string; name: string; parentId?: string | null; [extra: string]: any }

export type FolderApi<F extends Folder = Folder> = {
  list: (connectionId: string) => Promise<F[]>
  create: (connectionId: string, name: string, parentId: string | null) => Promise<F>
  rename: (connectionId: string, folderId: string, name: string) => Promise<any>
  remove: (connectionId: string, folderId: string) => Promise<any>
  move: (connectionId: string, folderId: string, parentId: string | null) => Promise<any>
}

/**
 * One sidebar panel's folder tree. Saved queries, workflows and dashboards each
 * have their own folders behind identical routes, so they share this — the only
 * difference between them is the `api` passed in.
 *
 * Nesting is capped at 3 levels server-side; every write here is optimistic and
 * mirrors what the server does, so the panel doesn't flicker on a round trip.
 *
 * Deleting a folder reparents *its own* contents up one level. This hook only
 * knows about folders, so the owner is told through `onFolderRemoved` to move
 * its items the same way.
 */
export default function useFolderTree<F extends Folder = Folder>(
  connectionId: string,
  api: FolderApi<F>,
  { toast, onFolderRemoved }: { toast: any; onFolderRemoved?: (folderId: string, parentId: string | null) => void }
) {
  const [folders, setFolders] = useState<F[]>([])

  const addFolder = async (name: string, parentId: string | null = null) => {
    const next = name?.trim()
    if (!next) return
    try {
      const folder = await api.create(connectionId, next, parentId)
      setFolders((prev) => [...prev, folder])
    } catch (e: any) {
      toast.error(`Couldn't create folder: ${e.message}`)
    }
  }

  const renameFolderById = async (fid: string, name: string) => {
    const next = name?.trim()
    if (!next) return
    setFolders((prev) => prev.map((f) => (f.id === fid ? { ...f, name: next } : f)))
    try {
      await api.rename(connectionId, fid, next)
    } catch (e: any) {
      toast.error(`Rename failed: ${e.message}`)
    }
  }

  const removeFolder = async (fid: string) => {
    // Reparent this folder's contents up one level locally, mirroring the server:
    // its subfolders and items move to its own parent (root for a top-level folder).
    const parentId = folders.find((f) => f.id === fid)?.parentId || null
    setFolders((prev) =>
      prev.filter((f) => f.id !== fid).map((f) => (f.parentId === fid ? { ...f, parentId } : f))
    )
    onFolderRemoved?.(fid, parentId)
    try {
      await api.remove(connectionId, fid)
    } catch (e: any) {
      toast.error(`Delete failed: ${e.message}`)
    }
  }

  const moveFolderToParent = async (fid: string, parentId: string | null) => {
    const target = parentId || null
    if (fid === target) return
    // Guard against cycles: refuse to nest a folder under its own descendant.
    const parentOf = new Map(folders.map((f) => [f.id, f.parentId || null]))
    for (let cur = target; cur; cur = parentOf.get(cur)) {
      if (cur === fid) return
    }
    setFolders((prev) => prev.map((f) => (f.id === fid ? { ...f, parentId: target } : f)))
    try {
      await api.move(connectionId, fid, target)
    } catch (e: any) {
      // Depth-cap or cycle rejection — refresh to resync with the server truth.
      toast.error(`Move failed: ${e.message}`)
      api.list(connectionId).then(setFolders)
    }
  }

  const refreshFolders = () => api.list(connectionId).then(setFolders)

  return { folders, setFolders, addFolder, renameFolderById, removeFolder, moveFolderToParent, refreshFolders }
}
