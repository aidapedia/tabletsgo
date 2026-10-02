import { useEffect, useState } from 'react'
import useFolderTree, { type Folder, type FolderApi } from './useFolderTree'

export type LibraryItem = { id: string; name: string; folderId?: string | null; [extra: string]: any }

export type LibraryApi<I extends LibraryItem = LibraryItem> = {
  list: (connectionId: string) => Promise<I[]>
  create: (connectionId: string, name: string, payload?: any, folderId?: string | null) => Promise<I>
  update: (connectionId: string, itemId: string, patch: any) => Promise<any>
  remove: (connectionId: string, itemId: string) => Promise<any>
}

type Options<I extends LibraryItem, F extends Folder> = {
  /** Tab kind and tab-key prefix; also the `kind` an export file must declare. */
  kind: 'workflow' | 'dashboard'
  /** Human label used in default names ("Workflow 3", "Imported dashboard"). */
  label: string
  api: LibraryApi<I>
  folderApi: FolderApi<F>
  /** The field an export file carries its body in. */
  payloadKey: 'graph' | 'config'
  sanitize: (payload: any) => any
  /** The optimistic row to show before the server's own shape arrives. */
  row: (created: I, folderId: string | null) => I
  toast: any
  openTab: (tab: any) => void
  retitleTab: (key: string, title: string) => void
  dropTab: (key: string) => void
  /** Called once with the first loaded list — the console uses it for deep links. */
  onLoaded?: (items: I[]) => void
}

/**
 * One per-connection resource library: the list, its folders, and the sidebar
 * panel's actions over both.
 *
 * Workflows and dashboards are the same object to the console — a named,
 * foldered thing you open in a tab, create, rename, delete and import from a
 * JSON export — so they share this hook rather than two parallel copies of it.
 * Everything that genuinely differs (the tab kind, the export's payload field,
 * the optimistic row shape) is passed in.
 */
export default function useResourceLibrary<I extends LibraryItem, F extends Folder>(
  connectionId: string,
  opts: Options<I, F>
) {
  const { kind, label, api, folderApi, payloadKey, sanitize, row, toast, openTab, retitleTab, dropTab } = opts
  const [items, setItems] = useState<I[]>([])

  const tabKey = (itemId: string) => `${kind}:${itemId}`

  const folderTree = useFolderTree<F>(connectionId, folderApi, {
    toast,
    // Mirror the server: a deleted folder's items move up to its parent.
    onFolderRemoved: (fid, parentId) =>
      setItems((prev) => prev.map((it) => (it.folderId === fid ? { ...it, folderId: parentId } : it))),
  })
  const { refreshFolders } = folderTree

  useEffect(() => {
    let alive = true
    api.list(connectionId).then((list) => {
      if (!alive) return
      setItems(list)
      opts.onLoaded?.(list)
    })
    refreshFolders()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId])

  // Open in its own tab; the title tracks the item's name (kept in sync on
  // rename). Focus it if already open.
  const open = (item: LibraryItem) =>
    openTab({ key: tabKey(item.id), kind, [`${kind}Id`]: item.id, title: item.name })

  const create = async (folderId: string | null = null) => {
    try {
      const made = await api.create(connectionId, `${label} ${items.length + 1}`, undefined, folderId)
      setItems((prev) => [row(made, folderId || null), ...prev])
      open(made)
    } catch (e: any) {
      toast.error(`Couldn't create ${kind}: ${e.message}`)
    }
  }

  const rename = async (itemId: string, name: string) => {
    const next = name?.trim()
    if (!next) return
    renamedExternally(itemId, next)
    try {
      await api.update(connectionId, itemId, { name: next })
    } catch (e: any) {
      toast.error(`Rename failed: ${e.message}`)
    }
  }

  // The open view renamed it itself (DashboardView's settings modal) — the
  // server already knows, so this only syncs the list and the tab title.
  const renamedExternally = (itemId: string, name: string) => {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, name } : it)))
    retitleTab(tabKey(itemId), name)
  }

  const remove = async (itemId: string) => {
    setItems((prev) => prev.filter((it) => it.id !== itemId))
    dropTab(tabKey(itemId))
    try {
      await api.remove(connectionId, itemId)
    } catch (e: any) {
      toast.error(`Delete failed: ${e.message}`)
    }
  }

  const importFile = async (file: File) => {
    try {
      const doc = JSON.parse(await file.text())
      if (doc?.kind !== kind || !doc[payloadKey]) throw new Error(`Not a ${kind} export file.`)
      const made = await api.create(connectionId, doc.name || `Imported ${kind}`, sanitize(doc[payloadKey]))
      setItems((prev) => [row(made, null), ...prev])
      open(made)
    } catch (e: any) {
      toast.error(`Import failed: ${e.message}`)
    }
  }

  const moveToFolder = async (itemId: string, folderId: string | null) => {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, folderId: folderId || null } : it)))
    try {
      await api.update(connectionId, itemId, { folderId: folderId || null })
    } catch (e: any) {
      toast.error(`Move failed: ${e.message}`)
    }
  }

  const refresh = () => {
    api.list(connectionId).then(setItems)
    refreshFolders()
  }

  return { items, setItems, open, create, rename, renamedExternally, remove, importFile, moveToFolder, refresh, ...folderTree }
}
