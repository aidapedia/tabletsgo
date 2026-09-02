import { useEffect, useState } from 'react'
import {
  fetchSaved,
  createSaved,
  deleteSaved,
  renameSaved,
  updateSaved,
  fetchFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  moveFolder,
} from '../lib/savedQueries'
import useFolderTree from './useFolderTree'

type Options = {
  toast: any
  openTab: (tab: any) => void
  retitleTab: (key: string, title: string) => void
  /** Fired after a new query is saved — the console reveals the panel. */
  onSaved?: () => void
}

/**
 * The connection's saved queries and their folders.
 *
 * Unlike workflows and dashboards a saved query is not a document you open and
 * edit in place: it is text that seeds a query tab, and saving from a tab that
 * *came from* a saved query updates that one rather than making another. That
 * asymmetry is why this doesn't go through `useResourceLibrary` — only the
 * folder half is shared.
 */
export default function useSavedQueries(connectionId: string, { toast, openTab, retitleTab, onSaved }: Options) {
  const [saved, setSaved] = useState<any[]>([])
  const [savingQuery, setSavingQuery] = useState<string | null>(null) // sql awaiting a name | null

  const folderTree = useFolderTree(
    connectionId,
    { list: fetchFolders, create: createFolder, rename: renameFolder, remove: deleteFolder, move: moveFolder },
    {
      toast,
      onFolderRemoved: (fid, parentId) =>
        setSaved((prev) => prev.map((s) => (s.folderId === fid ? { ...s, folderId: parentId } : s))),
    }
  )
  const { refreshFolders } = folderTree

  useEffect(() => {
    let alive = true
    fetchSaved(connectionId).then((list) => alive && setSaved(list))
    refreshFolders()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId])

  // Open a saved query in its own identity-bearing tab: title tracks the saved
  // query's name (and stays in sync on rename), focus if already open.
  const openSavedQuery = (q: any) =>
    openTab({ key: `query:saved:${q.id}`, kind: 'query', title: q.name, sql: q.sql, savedId: q.id })

  const updateSavedQuery = async (sid: string, sql: string) => {
    setSaved((prev) => prev.map((s) => (s.id === sid ? { ...s, sql } : s)))
    try {
      await updateSaved(connectionId, sid, { sql })
      toast.success('Query updated.')
    } catch (e: any) {
      toast.error(`Update failed: ${e.message}`)
    }
  }

  /**
   * Save from a query tab. A tab opened from a saved query updates it in place;
   * anything else opens the name drawer (`savingQuery`).
   */
  const saveQuery = (sql: string, savedId?: string | null) => {
    const trimmed = sql.trim()
    if (!trimmed) return
    if (savedId) {
      updateSavedQuery(savedId, trimmed)
      return
    }
    setSavingQuery(trimmed)
  }

  const commitSaveQuery = async (name: string) => {
    const sqlToSave = savingQuery
    setSavingQuery(null)
    try {
      const entry = await createSaved(connectionId, { name, sql: sqlToSave })
      setSaved((prev) => [entry, ...prev])
      onSaved?.()
      toast.success(`Saved “${entry.name}”.`)
    } catch (e: any) {
      toast.error(`Save failed: ${e.message}`)
    }
  }

  const removeSaved = async (sid: string) => {
    setSaved((prev) => prev.filter((s) => s.id !== sid))
    try {
      await deleteSaved(connectionId, sid)
    } catch (e: any) {
      toast.error(`Delete failed: ${e.message}`)
    }
  }

  const renameSavedQuery = async (sid: string, name: string) => {
    const next = name?.trim()
    if (!next) return
    setSaved((prev) => prev.map((s) => (s.id === sid ? { ...s, name: next } : s)))
    // Keep the matching open saved-query tab's title in sync.
    retitleTab(`query:saved:${sid}`, next)
    try {
      await renameSaved(connectionId, sid, next)
      toast.success(`Renamed to “${next}”.`)
    } catch (e: any) {
      toast.error(`Rename failed: ${e.message}`)
    }
  }

  const moveSavedToFolder = async (sid: string, folderId: string | null) => {
    setSaved((prev) => prev.map((s) => (s.id === sid ? { ...s, folderId: folderId || null } : s)))
    try {
      await updateSaved(connectionId, sid, { folderId: folderId || null })
    } catch (e: any) {
      toast.error(`Move failed: ${e.message}`)
    }
  }

  const refresh = () => {
    fetchSaved(connectionId).then(setSaved)
    refreshFolders()
  }

  return {
    saved,
    setSaved,
    savingQuery,
    setSavingQuery,
    openSavedQuery,
    saveQuery,
    commitSaveQuery,
    updateSavedQuery,
    removeSaved,
    renameSavedQuery,
    moveSavedToFolder,
    refresh,
    ...folderTree,
  }
}
