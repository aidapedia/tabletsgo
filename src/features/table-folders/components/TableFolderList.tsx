import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  EditIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  MoreVerticalIcon,
  SettingsIcon,
  TrashIcon,
} from '@/shared/ui/icons'
import IconButton from '@/shared/ui/buttons/IconButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import Popover from '@/shared/ui/overlay/Popover'
import { Input } from '@/shared/ui/form/Input'
import { useToast } from '@/shared/ui/feedback/Toast'
import { createTableFolder, updateTableFolder, setTableFolder } from '../lib/api'
import { withTableAssignment } from '../lib/assign'
import { FOLDER_COLORS, MAX_TABLE_FOLDER_DEPTH, type TableFolder } from '../types'

// Same compact folder row as the saved-queries / dashboards / workflows panels.
const rowBase = 'group flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-xs'
const rowIdle = 'text-ink-dim hover:bg-elevated hover:text-ink'

type TableObject = { name: string; type: string }

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

/**
 * The Tables sidebar in "folders" mode: the connection's tables grouped by the
 * generic folders tree (type='table'), nesting up to MAX_TABLE_FOLDER_DEPTH —
 * the same folder UX as saved queries, dashboards and workflows, plus a color
 * per folder (what a domain's color became). Tables with no folder sit in a
 * trailing "Ungrouped" area, which doubles as the drop target that ungroups a
 * table and the root drop target for folders.
 *
 * Self-contained like the picker panel: assignment, folder creation, renames
 * and folder moves happen here and are handed back via `onChange`; recoloring
 * and deleting are delegated so they reuse the caller's slide-over wiring.
 *
 * `renderTable` is the caller's own table row renderer; the second argument is
 * spread onto the row so it becomes draggable without duplicating that markup.
 */
export default function TableFolderList({
  connectionId,
  folders,
  tables,
  searching = false,
  onChange,
  onEdit,
  onDelete,
  renderTable,
}: {
  connectionId: string
  folders: TableFolder[]
  tables: TableObject[]
  searching?: boolean
  onChange: (next: TableFolder[]) => void
  onEdit: (folder: TableFolder) => void
  onDelete: (folderId: string) => void
  renderTable: (obj: TableObject, rowProps: Record<string, unknown>) => ReactNode
}) {
  const toast = useToast()
  // Folders start expanded (the old grouped view showed everything at once), so
  // track the collapsed ones instead of the open ones.
  const [collapsed, setCollapsed] = useState(() => new Set<string>())
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null)
  const [newName, setNewName] = useState('')
  const [drag, setDrag] = useState<{ type: 'table' | 'folder'; id: string } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null | undefined>(undefined) // folder id | null (root) | undefined

  const sorted = useMemo(() => [...folders].sort(byName), [folders])
  const folderOf = useMemo(() => {
    const map: Record<string, TableFolder> = {}
    for (const f of folders) for (const tn of f.tables || []) map[tn] = f
    return map
  }, [folders])

  const childFolders = (pid: string | null) => sorted.filter((f) => (f.parentId || null) === pid)
  const itemsIn = (f: TableFolder) => tables.filter((o) => f.tables?.includes(o.name))
  const ungrouped = tables.filter((o) => !folderOf[o.name])
  // Visible tables in a folder plus all of its subfolders.
  const subtreeCount = (f: TableFolder): number =>
    itemsIn(f).length + childFolders(f.id).reduce((n, c) => n + subtreeCount(c), 0)

  // parentId lookup for cycle-safe / depth-safe drop-target checks.
  const parentOf = useMemo(() => new Map(folders.map((f) => [f.id, f.parentId || null])), [folders])
  // Levels from the root down to `fid` (root folder = 1, null = 0).
  const depthOf = (fid: string | null) => {
    let depth = 0
    let cur = fid
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      depth++
      seen.add(cur)
      cur = parentOf.get(cur) || null
    }
    return depth
  }
  // Height of the subtree rooted at `fid` (the folder itself = 1).
  const heightOf = (fid: string): number => 1 + childFolders(fid).reduce((m, c) => Math.max(m, heightOf(c.id)), 0)
  // True if `targetId` is `ancestorId` or nested somewhere beneath it.
  const isSelfOrDescendant = (targetId: string | null, ancestorId: string) => {
    let cur = targetId
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      if (cur === ancestorId) return true
      seen.add(cur)
      cur = parentOf.get(cur) || null
    }
    return false
  }
  const canNestUnder = (fid: string) => depthOf(fid) < MAX_TABLE_FOLDER_DEPTH

  // A folder auto-expands during search if it (or any descendant) holds a match.
  const hasMatch = (f: TableFolder): boolean => itemsIn(f).length > 0 || childFolders(f.id).some(hasMatch)

  const toggle = (fid: string) =>
    setCollapsed((s) => {
      const n = new Set(s)
      n.has(fid) ? n.delete(fid) : n.add(fid)
      return n
    })
  const expand = (fid: string) =>
    setCollapsed((s) => {
      const n = new Set(s)
      n.delete(fid)
      return n
    })

  // ---- Mutations (optimistic; revert + toast on failure) ----
  const assign = async (table: string, folderId: string | null) => {
    if ((folderOf[table]?.id || null) === folderId) return
    const prev = folders
    onChange(withTableAssignment(folders, table, folderId))
    try {
      await setTableFolder(connectionId, table, folderId)
    } catch (e) {
      onChange(prev)
      toast.error(`Couldn't move table: ${e.message}`)
    }
  }

  const moveFolderTo = async (folderId: string, parentId: string | null) => {
    const prev = folders
    onChange(folders.map((f) => (f.id === folderId ? { ...f, parentId } : f)))
    try {
      await updateTableFolder(connectionId, folderId, { parentId })
    } catch (e) {
      onChange(prev)
      toast.error(`Couldn't move folder: ${e.message}`)
    }
  }

  const commitRename = async () => {
    const target = renaming ? folders.find((f) => f.id === renaming.id) : null
    const name = renaming?.value.trim()
    setRenaming(null)
    if (!target || !name || name === target.name) return
    const prev = folders
    onChange(folders.map((f) => (f.id === target.id ? { ...f, name } : f)))
    try {
      await updateTableFolder(connectionId, target.id, { name })
    } catch (e) {
      onChange(prev)
      toast.error(`Couldn't rename folder: ${e.message}`)
    }
  }

  const commitNewFolder = async () => {
    const name = newName.trim()
    const parentId = creating?.parentId ?? null
    setNewName('')
    setCreating(null)
    if (!name) return
    try {
      const created = await createTableFolder(connectionId, {
        name,
        parentId,
        color: FOLDER_COLORS[folders.length % FOLDER_COLORS.length],
      })
      onChange([...folders, created])
    } catch (e) {
      toast.error(`Couldn't create folder: ${e.message}`)
    }
  }
  const startSubfolder = (parentId: string) => {
    expand(parentId)
    setNewName('')
    setCreating({ parentId })
  }

  // ---- Drag and drop: a table or a folder into a folder / out to the root ----
  const canDropOn = (fid: string | null) => {
    if (!drag) return false
    if (drag.type === 'table') return true
    // A folder can't drop onto itself/its subtree, and the moved subtree must
    // still fit within the depth cap (the root is always fine height-wise).
    if (fid != null && isSelfOrDescendant(fid, drag.id)) return false
    return depthOf(fid) + heightOf(drag.id) <= MAX_TABLE_FOLDER_DEPTH
  }
  const dropProps = (fid: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!canDropOn(fid)) return
      e.preventDefault()
      setDropTarget(fid)
    },
    onDragLeave: () => setDropTarget((t) => (t === fid ? undefined : t)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      if (drag?.type === 'table') assign(drag.id, fid)
      else if (drag?.type === 'folder' && canDropOn(fid)) moveFolderTo(drag.id, fid)
      setDrag(null)
      setDropTarget(undefined)
    },
  })
  const dragStart = (type: 'table' | 'folder', id: string) => (e: React.DragEvent) => {
    e.stopPropagation()
    setDrag({ type, id })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
  const dragEnd = () => {
    setDrag(null)
    setDropTarget(undefined)
  }
  const tableRowProps = (obj: TableObject) => ({
    draggable: true,
    onDragStart: dragStart('table', obj.name),
    onDragEnd: dragEnd,
    className: drag?.type === 'table' && drag.id === obj.name ? 'opacity-50' : '',
  })

  const renderNewFolderInput = () => (
    <div className="flex items-center gap-2 px-2.5 py-1">
      <FolderIcon className="shrink-0 text-ink-faint" width={15} height={15} />
      <Input
        autoFocus
        className="!py-1"
        placeholder="Folder name…"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onBlur={commitNewFolder}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitNewFolder()
          else if (e.key === 'Escape') {
            setNewName('')
            setCreating(null)
          }
        }}
      />
    </div>
  )

  const renderFolder = (folder: TableFolder) => {
    const items = itemsIn(folder)
    const subfolders = childFolders(folder.id)
    const expanded = !collapsed.has(folder.id) || (searching && hasMatch(folder))
    const isDrop = dropTarget === folder.id
    const addingHere = creating?.parentId === folder.id
    const color = folder.color || undefined
    const tint = color ? { color } : undefined

    if (renaming?.id === folder.id) {
      return (
        <div key={folder.id} className="flex items-center gap-2 px-2.5 py-1">
          <FolderIcon className="shrink-0 text-ink-faint" width={15} height={15} style={tint} />
          <Input
            autoFocus
            className="!py-1"
            value={renaming.value}
            onChange={(e) => setRenaming({ id: folder.id, value: e.target.value })}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              else if (e.key === 'Escape') setRenaming(null)
            }}
          />
        </div>
      )
    }

    const FolderGlyph = expanded ? FolderOpenIcon : FolderIcon
    return (
      // The whole folder (header + contents) is the drop zone, so a dragged
      // table can land anywhere inside it, not just on the header row.
      <div
        key={folder.id}
        {...dropProps(folder.id)}
        className={`${drag?.type === 'folder' && drag.id === folder.id ? 'opacity-50' : ''} ${
          isDrop ? 'rounded-[7px] bg-green/10 ring-1 ring-green-dim' : ''
        }`}
      >
        <div
          draggable
          onDragStart={dragStart('folder', folder.id)}
          onDragEnd={dragEnd}
          onClick={() => toggle(folder.id)}
          className={`${rowBase} cursor-pointer ${isDrop ? 'text-ink' : rowIdle}`}
        >
          <FolderGlyph className="shrink-0 text-ink-faint" width={15} height={15} style={tint} />
          <span className="min-w-0 flex-1 truncate">{folder.name}</span>
          {subtreeCount(folder) > 0 && <span className="text-[10px] text-ink-faint">{subtreeCount(folder)}</span>}
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <Popover
              align="right"
              width={190}
              portal
              trigger={({ open, toggle: toggleMenu }) => (
                <IconButton
                  size="sm"
                  active={open}
                  onClick={toggleMenu}
                  aria-label="Folder actions"
                  className={open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                >
                  <MoreVerticalIcon width={15} height={15} />
                </IconButton>
              )}
            >
              {({ close }) => (
                <div className="p-1">
                  {canNestUnder(folder.id) && (
                    <MenuItem onClick={() => { startSubfolder(folder.id); close() }}>
                      <FolderPlusIcon width={14} height={14} /> New subfolder
                    </MenuItem>
                  )}
                  <MenuItem onClick={() => { setRenaming({ id: folder.id, value: folder.name }); close() }}>
                    <EditIcon width={14} height={14} /> Rename
                  </MenuItem>
                  <MenuItem onClick={() => { onEdit(folder); close() }}>
                    <SettingsIcon width={14} height={14} /> Name &amp; color…
                  </MenuItem>
                  <div className="my-1 h-px bg-edge" />
                  <MenuItem danger onClick={() => { onDelete(folder.id); close() }}>
                    <TrashIcon width={14} height={14} /> Delete folder
                  </MenuItem>
                </div>
              )}
            </Popover>
          </div>
        </div>

        {expanded && (
          <div className="ml-3 flex flex-col gap-0.5 border-l border-edge pl-1.5">
            {subfolders.map(renderFolder)}
            {addingHere && renderNewFolderInput()}
            {items.map((o) => renderTable(o, tableRowProps(o)))}
            {subfolders.length === 0 && items.length === 0 && !addingHere && (
              <div className="px-2.5 py-1 text-[11px] text-ink-faint">Empty — drag tables here</div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {childFolders(null).map(renderFolder)}
      {creating && creating.parentId == null && renderNewFolderInput()}

      {/* Ungrouped tables — also the drop zone that pulls a table or a folder
          back out to the root. */}
      <div
        {...dropProps(null)}
        className={`mt-0.5 flex flex-col gap-0.5 rounded-[7px] ${
          dropTarget === null ? 'bg-green/10 ring-1 ring-green-dim' : ''
        }`}
      >
        {folders.length > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            <span>Ungrouped</span>
            {ungrouped.length > 0 && <span className="opacity-60">{ungrouped.length}</span>}
          </div>
        )}
        {ungrouped.map((o) => renderTable(o, tableRowProps(o)))}
        {ungrouped.length === 0 && folders.length > 0 && (
          <div className="px-2.5 py-1 text-[11px] text-ink-faint">Drag tables out of folders here</div>
        )}
      </div>

      <button
        type="button"
        onClick={() => { setNewName(''); setCreating({ parentId: null }) }}
        className="mt-1 flex w-full items-center gap-2 rounded-soft border border-dashed border-edge px-2.5 py-1.5 text-[11px] text-ink-faint transition-colors hover:border-edge-strong hover:text-ink"
      >
        <FolderPlusIcon width={14} height={14} /> New folder
      </button>
    </div>
  )
}
