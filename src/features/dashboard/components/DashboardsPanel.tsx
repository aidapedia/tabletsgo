import { useMemo, useState } from 'react'
import {
  EditIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GridIcon,
  MoreVerticalIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  TrashIcon,
} from '@/shared/ui/icons'
import { Input } from '@/shared/ui/form/Input'
import IconButton from '@/shared/ui/buttons/IconButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import RowLabel from '@/shared/ui/RowLabel'
import ListRow from '@/shared/ui/ListRow'
import Popover from '@/shared/ui/overlay/Popover'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import { MAX_DASHBOARD_FOLDER_DEPTH } from '../types'
import type { DashboardFolder, DashboardSummary } from '../types'

// Compact folder rows that match the saved-queries panel style.
const rowBase = 'group flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-xs'
const rowIdle = 'text-ink-dim hover:bg-elevated hover:text-ink'

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

// Left-rail list of this connection's dashboards, organized into folders
// (nesting capped at MAX_DASHBOARD_FOLDER_DEPTH levels). Modeled on
// SavedQueriesPanel: open in a tab, create, rename inline, delete, drag into
// folders, import from JSON.
export default function DashboardsPanel({
  dashboards = [],
  folders = [],
  activeId,
  onOpen,
  onNew,
  onImport,
  onRename,
  onDelete,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveToFolder,
  onMoveFolder,
  onRefresh,
}: {
  dashboards: DashboardSummary[]
  folders: DashboardFolder[]
  activeId: string | null
  onOpen?: (d: DashboardSummary) => void
  onNew?: (folderId?: string | null) => void
  onImport?: () => void
  onRename?: (id: string, name: string) => void
  onDelete?: (id: string) => void
  onCreateFolder?: (name: string, parentId?: string | null) => void
  onRenameFolder?: (id: string, name: string) => void
  onDeleteFolder?: (id: string) => void
  onMoveToFolder?: (id: string, folderId: string | null) => void
  onMoveFolder?: (id: string, parentId: string | null) => void
  onRefresh?: () => void
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [openFolders, setOpenFolders] = useState(() => new Set<string>()) // expanded folder ids
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null) // dashboard rename
  const [renamingFolder, setRenamingFolder] = useState<{ id: string; value: string } | null>(null)
  const [creatingFolder, setCreatingFolder] = useState<{ parentId: string | null } | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [drag, setDrag] = useState<{ type: 'dashboard' | 'folder'; id: string } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null | undefined>(undefined) // folder id | null (root) | undefined (none)

  const q = filter.trim().toLowerCase()
  const matches = (d: DashboardSummary) => !q || d.name.toLowerCase().includes(q)

  const sortedFolders = useMemo(() => [...folders].sort(byName), [folders])
  const visibleDashboards = useMemo(() => dashboards.filter(matches), [dashboards, q])
  const childFolders = (pid: string | null) => sortedFolders.filter((f) => (f.parentId || null) === pid)
  const itemsIn = (fid: string | null) => visibleDashboards.filter((d) => (d.folderId || null) === fid).sort(byName)
  // Count of visible dashboards in a folder plus all of its subfolders.
  const subtreeItemCount = (fid: string): number =>
    itemsIn(fid).length + childFolders(fid).reduce((n, c) => n + subtreeItemCount(c.id), 0)
  const rootItems = useMemo(() => itemsIn(null), [visibleDashboards])

  // parentId lookup for cycle-safe / depth-safe drop-target checks.
  const parentOf = useMemo(() => new Map(folders.map((f) => [f.id, f.parentId || null])), [folders])
  // Number of levels from root down to `fid` (root folder = 1, null = 0).
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
  const heightOf = (fid: string): number =>
    1 + childFolders(fid).reduce((m, c) => Math.max(m, heightOf(c.id)), 0)
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
  // Whether a folder at `fid` may still hold a subfolder (depth cap).
  const canNestUnder = (fid: string) => depthOf(fid) < MAX_DASHBOARD_FOLDER_DEPTH

  // A folder auto-expands during search if it (or any descendant) holds a match.
  const folderHasMatch = (fid: string): boolean =>
    itemsIn(fid).length > 0 || childFolders(fid).some((c) => folderHasMatch(c.id))

  const toggleFolder = (fid: string) =>
    setOpenFolders((s) => {
      const n = new Set(s)
      n.has(fid) ? n.delete(fid) : n.add(fid)
      return n
    })
  const expandFolder = (fid: string) => setOpenFolders((s) => new Set(s).add(fid))

  const commitRename = () => {
    if (renaming?.value.trim()) onRename?.(renaming.id, renaming.value.trim())
    setRenaming(null)
  }
  const commitFolderRename = () => {
    if (renamingFolder?.value.trim()) onRenameFolder?.(renamingFolder.id, renamingFolder.value.trim())
    setRenamingFolder(null)
  }
  const commitNewFolder = () => {
    if (newFolderName.trim()) onCreateFolder?.(newFolderName.trim(), creatingFolder?.parentId ?? null)
    setNewFolderName('')
    setCreatingFolder(null)
  }
  const startSubfolder = (parentId: string) => {
    expandFolder(parentId)
    setNewFolderName('')
    setCreatingFolder({ parentId })
  }

  // ---- Drag and drop: move a dashboard OR a folder into a folder / back to root ----
  const onDashboardDragStart = (e: React.DragEvent, id: string) => {
    setDrag({ type: 'dashboard', id })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
  const onFolderDragStart = (e: React.DragEvent, id: string) => {
    e.stopPropagation()
    setDrag({ type: 'folder', id })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
  const onDragEnd = () => {
    setDrag(null)
    setDropTarget(undefined)
  }
  // Whether the current drag may land on folder `fid` (null = root).
  const canDropOn = (fid: string | null) => {
    if (!drag) return false
    if (drag.type === 'dashboard') return true
    // A folder can't drop onto itself/its subtree, and the moved subtree must
    // still fit within the depth cap (root is always fine height-wise).
    if (fid != null && isSelfOrDescendant(fid, drag.id)) return false
    return depthOf(fid) + heightOf(drag.id) <= MAX_DASHBOARD_FOLDER_DEPTH
  }
  const handleDrop = (fid: string | null) => {
    if (drag?.type === 'dashboard') onMoveToFolder?.(drag.id, fid)
    else if (drag?.type === 'folder' && canDropOn(fid)) onMoveFolder?.(drag.id, fid)
    setDrag(null)
    setDropTarget(undefined)
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
      handleDrop(fid)
    },
  })

  // ---- Renderers (plain functions so rows reconcile by key, never remount) ----
  const renderItem = (d: DashboardSummary) => {
    if (renaming?.id === d.id) {
      return (
        <div key={d.id} className="flex items-center gap-2 px-2.5 py-1">
          <GridIcon className="shrink-0 text-ink-faint" width={14} height={14} />
          <Input
            autoFocus
            className="!py-1"
            value={renaming.value}
            onChange={(e) => setRenaming({ id: d.id, value: e.target.value })}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              else if (e.key === 'Escape') setRenaming(null)
            }}
          />
        </div>
      )
    }

    return (
      <ListRow
        key={d.id}
        draggable
        active={d.id === activeId}
        onDragStart={(e: React.DragEvent) => onDashboardDragStart(e, d.id)}
        onDragEnd={onDragEnd}
        onClick={() => onOpen?.(d)}
        className={drag?.type === 'dashboard' && drag.id === d.id ? 'opacity-50' : ''}
        icon={<GridIcon className="shrink-0 text-ink-faint" width={14} height={14} />}
        trailing={
          <Popover
            align="right"
            width={170}
            trigger={({ open, toggle }) => (
              <IconButton
                size="sm"
                active={open}
                onClick={toggle}
                aria-label="Dashboard actions"
                className={open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
              >
                <MoreVerticalIcon width={15} height={15} />
              </IconButton>
            )}
          >
            {({ close }) => (
              <div className="p-1">
                <MenuItem onClick={() => { setRenaming({ id: d.id, value: d.name }); close() }}>
                  <EditIcon width={14} height={14} /> Rename
                </MenuItem>
                <div className="my-1 h-px bg-edge" />
                <MenuItem danger onClick={() => { onDelete?.(d.id); close() }}>
                  <TrashIcon width={14} height={14} /> Delete
                </MenuItem>
              </div>
            )}
          </Popover>
        }
      >
        <RowLabel>{d.name}</RowLabel>
      </ListRow>
    )
  }

  const renderFolder = (f: DashboardFolder) => {
    const items = itemsIn(f.id)
    const subfolders = childFolders(f.id)
    const expanded = openFolders.has(f.id) || (!!q && folderHasMatch(f.id))
    const isDrop = dropTarget === f.id
    const addingHere = creatingFolder?.parentId === f.id
    const canAddSub = canNestUnder(f.id)

    if (renamingFolder?.id === f.id) {
      return (
        <div key={f.id} className="flex items-center gap-2 px-2.5 py-1">
          <FolderIcon className="shrink-0 text-ink-faint" width={15} height={15} />
          <Input
            autoFocus
            className="!py-1"
            value={renamingFolder.value}
            onChange={(e) => setRenamingFolder({ id: f.id, value: e.target.value })}
            onBlur={commitFolderRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitFolderRename()
              else if (e.key === 'Escape') setRenamingFolder(null)
            }}
          />
        </div>
      )
    }

    return (
      <div key={f.id}>
        <div
          draggable
          onDragStart={(e) => onFolderDragStart(e, f.id)}
          onDragEnd={onDragEnd}
          onClick={() => toggleFolder(f.id)}
          {...dropProps(f.id)}
          className={`${rowBase} cursor-pointer ${drag?.type === 'folder' && drag.id === f.id ? 'opacity-50' : ''} ${
            isDrop ? 'bg-green/15 text-ink ring-1 ring-green-dim' : rowIdle
          }`}
        >
          {expanded ? (
            <FolderOpenIcon className="shrink-0 text-ink-faint" width={15} height={15} />
          ) : (
            <FolderIcon className="shrink-0 text-ink-faint" width={15} height={15} />
          )}
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          {subtreeItemCount(f.id) > 0 && (
            <span className="text-[10px] text-ink-faint">{subtreeItemCount(f.id)}</span>
          )}
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <Popover
              align="right"
              width={180}
              trigger={({ open, toggle }) => (
                <IconButton size="sm" active={open} onClick={toggle} aria-label="Folder actions" className={open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}>
                  <MoreVerticalIcon width={15} height={15} />
                </IconButton>
              )}
            >
              {({ close }) => (
                <div className="p-1">
                  <MenuItem onClick={() => { onNew?.(f.id); close() }}>
                    <PlusIcon width={14} height={14} /> New dashboard
                  </MenuItem>
                  {canAddSub && (
                    <MenuItem onClick={() => { startSubfolder(f.id); close() }}>
                      <FolderPlusIcon width={14} height={14} /> New subfolder
                    </MenuItem>
                  )}
                  <MenuItem onClick={() => { setRenamingFolder({ id: f.id, value: f.name }); close() }}>
                    <EditIcon width={14} height={14} /> Rename
                  </MenuItem>
                  <div className="my-1 h-px bg-edge" />
                  <MenuItem danger onClick={() => { onDeleteFolder?.(f.id); close() }}>
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
            {items.map(renderItem)}
            {subfolders.length === 0 && items.length === 0 && !addingHere && (
              <div className="px-2.5 py-1 text-[11px] text-ink-faint">Empty — drag dashboards here</div>
            )}
          </div>
        )}
      </div>
    )
  }

  const renderNewFolderInput = () => (
    <div className="flex items-center gap-2 px-2.5 py-1">
      <FolderIcon className="shrink-0 text-ink-faint" width={15} height={15} />
      <Input
        autoFocus
        className="!py-1"
        placeholder="Folder name…"
        value={newFolderName}
        onChange={(e) => setNewFolderName(e.target.value)}
        onBlur={commitNewFolder}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitNewFolder()
          else if (e.key === 'Escape') {
            setNewFolderName('')
            setCreatingFolder(null)
          }
        }}
      />
    </div>
  )

  const rootFolders = childFolders(null)
  const nothing = dashboards.length === 0 && folders.length === 0

  return (
    <>
      <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
        <span className="text-xs font-semibold">Dashboards</span>
        <div className="flex gap-1">
          <Tooltip label="Refresh" placement="bottom">
            <IconButton onClick={onRefresh}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Tooltip label="Search" placement="bottom">
            <IconButton
              active={searchOpen}
              onClick={() => {
                if (searchOpen) setFilter('')
                setSearchOpen((o) => !o)
              }}
            >
              <SearchIcon width={15} height={15} />
            </IconButton>
          </Tooltip>
          <Tooltip label="New folder" placement="bottom">
            <IconButton onClick={() => { setNewFolderName(''); setCreatingFolder({ parentId: null }) }}>
              <FolderPlusIcon />
            </IconButton>
          </Tooltip>
          <Tooltip label="New dashboard" placement="bottom">
            <IconButton onClick={() => onNew?.(null)}>
              <PlusIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {searchOpen && (
        <div className="px-3.5 pb-2">
          <Input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search dashboards…"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {creatingFolder && creatingFolder.parentId == null && renderNewFolderInput()}

        {nothing && !creatingFolder ? (
          <div className="px-2 py-3 text-[11px] text-ink-faint">{q ? 'No matches' : 'No dashboards yet.'}</div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {rootFolders.map(renderFolder)}

            {/* Root (un-foldered) dashboards — also the drop zone for "remove from folder" */}
            <div
              {...dropProps(null)}
              className={`mt-0.5 flex flex-col gap-0.5 rounded-[7px] ${
                dropTarget === null ? 'bg-green/10 ring-1 ring-green-dim' : ''
              }`}
            >
              {rootItems.map(renderItem)}
              {rootItems.length === 0 && (
                <div className="px-2.5 py-1 text-[11px] text-ink-faint">
                  {q ? 'No matches' : folders.length ? 'Drag dashboards out of folders here' : 'No dashboards.'}
                </div>
              )}
            </div>
          </div>
        )}

        {onImport && (
          <button
            type="button"
            onClick={onImport}
            className="mt-2 w-full rounded-soft border border-dashed border-edge px-2.5 py-2 text-[11px] text-ink-faint transition-colors hover:border-edge-strong hover:text-ink"
          >
            Import from JSON…
          </button>
        )}
      </div>
    </>
  )
}
