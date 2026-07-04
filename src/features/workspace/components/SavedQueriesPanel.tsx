import { useMemo, useState } from 'react'
import {
  CodeIcon,
  EditIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  MoreVerticalIcon,
  RefreshIcon,
  SearchIcon,
  TrashIcon,
} from '@/shared/ui/icons'
import { controlClass } from '@/shared/ui/form/Input'
import IconButton from '@/shared/ui/buttons/IconButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import RowLabel from '@/shared/ui/RowLabel'
import Popover from '@/shared/ui/overlay/Popover'
import Tooltip from '@/shared/ui/overlay/Tooltip'

// Compact rows that match the table list's type style (text-xs, not bold).
const rowBase = 'group flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-xs'
const rowIdle = 'text-ink-dim hover:bg-elevated hover:text-ink'

const byName = (a, b) => a.name.localeCompare(b.name)

export default function SavedQueriesPanel({
  saved = [],
  folders = [],
  onOpenSaved,
  onRenameSaved,
  onDeleteSaved,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveToFolder,
  onRefresh,
}: any) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [openFolders, setOpenFolders] = useState(() => new Set()) // expanded folder ids
  const [renaming, setRenaming] = useState(null) // { id, value } — saved query rename
  const [renamingFolder, setRenamingFolder] = useState(null) // { id, value }
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [dragId, setDragId] = useState(null) // saved query id being dragged
  const [dropTarget, setDropTarget] = useState(undefined) // folder id | null (root) | undefined (none)

  const q = filter.trim().toLowerCase()
  const matches = (s) => !q || s.name.toLowerCase().includes(q) || (s.sql || '').toLowerCase().includes(q)

  const sortedFolders = useMemo(() => [...folders].sort(byName), [folders])
  const visibleSaved = useMemo(() => saved.filter(matches), [saved, q])
  const itemsIn = (fid) => visibleSaved.filter((s) => (s.folderId || null) === fid).sort(byName)
  const rootItems = useMemo(() => itemsIn(null), [visibleSaved])

  const toggleFolder = (fid) =>
    setOpenFolders((s) => {
      const n = new Set(s)
      n.has(fid) ? n.delete(fid) : n.add(fid)
      return n
    })

  const commitRename = () => {
    if (renaming?.value.trim()) onRenameSaved?.(renaming.id, renaming.value.trim())
    setRenaming(null)
  }
  const commitFolderRename = () => {
    if (renamingFolder?.value.trim()) onRenameFolder?.(renamingFolder.id, renamingFolder.value.trim())
    setRenamingFolder(null)
  }
  const commitNewFolder = () => {
    if (newFolderName.trim()) onCreateFolder?.(newFolderName.trim())
    setNewFolderName('')
    setCreatingFolder(false)
  }

  // ---- Drag and drop (move a saved query into a folder / back to root) ----
  const onItemDragStart = (e, id) => {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
  const onItemDragEnd = () => {
    setDragId(null)
    setDropTarget(undefined)
  }
  const handleDrop = (fid) => {
    if (dragId != null) onMoveToFolder?.(dragId, fid)
    setDragId(null)
    setDropTarget(undefined)
  }
  const dropProps = (fid) => ({
    onDragOver: (e) => {
      if (dragId == null) return
      e.preventDefault()
      setDropTarget(fid)
    },
    onDragLeave: () => setDropTarget((t) => (t === fid ? undefined : t)),
    onDrop: (e) => {
      e.preventDefault()
      handleDrop(fid)
    },
  })

  // ---- Renderers (plain functions so rows reconcile by key, never remount) ----
  const renderItem = (s) => {
    if (renaming?.id === s.id) {
      return (
        <div key={s.id} className="flex items-center gap-2 px-2.5 py-1">
          <CodeIcon className="shrink-0 text-ink-faint" width={14} height={14} />
          <input
            autoFocus
            className={`${controlClass} !py-1`}
            value={renaming.value}
            onChange={(e) => setRenaming({ id: s.id, value: e.target.value })}
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
      <div
        key={s.id}
        draggable
        onDragStart={(e) => onItemDragStart(e, s.id)}
        onDragEnd={onItemDragEnd}
        className={`${rowBase} ${rowIdle} cursor-pointer ${dragId === s.id ? 'opacity-50' : ''}`}
      >
        <CodeIcon className="shrink-0 text-ink-faint" width={14} height={14} />
        <RowLabel onClick={() => onOpenSaved?.(s)}>{s.name}</RowLabel>
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <Popover
            align="right"
            width={210}
            trigger={({ open, toggle }) => (
              <IconButton size="sm" active={open} onClick={toggle} aria-label="Query actions" className={open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}>
                <MoreVerticalIcon width={15} height={15} />
              </IconButton>
            )}
          >
            {({ close }) => (
              <div className="p-1">
                <MenuItem onClick={() => { onOpenSaved?.(s); close() }}>
                  <CodeIcon width={14} height={14} /> Open in SQL Editor
                </MenuItem>
                <MenuItem onClick={() => { setRenaming({ id: s.id, value: s.name }); close() }}>
                  <EditIcon width={14} height={14} /> Rename
                </MenuItem>

                <div className="my-1 h-px bg-edge" />
                <MenuItem danger onClick={() => { onDeleteSaved?.(s.id); close() }}>
                  <TrashIcon width={14} height={14} /> Delete
                </MenuItem>
              </div>
            )}
          </Popover>
        </div>
      </div>
    )
  }

  const renderFolder = (f) => {
    const items = itemsIn(f.id)
    const expanded = openFolders.has(f.id) || (q && items.length > 0)
    const isDrop = dropTarget === f.id

    if (renamingFolder?.id === f.id) {
      return (
        <div key={f.id} className="flex items-center gap-2 px-2.5 py-1">
          <FolderIcon className="shrink-0 text-ink-faint" width={15} height={15} />
          <input
            autoFocus
            className={`${controlClass} !py-1`}
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
          onClick={() => toggleFolder(f.id)}
          {...dropProps(f.id)}
          className={`${rowBase} cursor-pointer ${isDrop ? 'bg-green/15 text-ink ring-1 ring-green-dim' : rowIdle}`}
        >
          {expanded ? (
            <FolderOpenIcon className="shrink-0 text-ink-faint" width={15} height={15} />
          ) : (
            <FolderIcon className="shrink-0 text-ink-faint" width={15} height={15} />
          )}
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          {items.length > 0 && <span className="text-[10px] text-ink-faint">{items.length}</span>}
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <Popover
              align="right"
              width={170}
              trigger={({ open, toggle }) => (
                <IconButton size="sm" active={open} onClick={toggle} aria-label="Folder actions" className={open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}>
                  <MoreVerticalIcon width={15} height={15} />
                </IconButton>
              )}
            >
              {({ close }) => (
                <div className="p-1">
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
          <div className="ml-3 flex flex-col border-l border-edge pl-1.5">
            {items.length === 0 ? (
              <div className="px-2.5 py-1 text-[11px] text-ink-faint">Empty — drag queries here</div>
            ) : (
              items.map(renderItem)
            )}
          </div>
        )}
      </div>
    )
  }

  const nothingSaved = saved.length === 0 && folders.length === 0

  return (
    <>
      <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
        <span className="text-xs font-semibold">Saved queries</span>
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
            <IconButton onClick={() => setCreatingFolder(true)}>
              <FolderPlusIcon />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {searchOpen && (
        <div className="px-3.5 pb-2">
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search saved queries…"
            className={controlClass}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {creatingFolder && (
          <div className="flex items-center gap-2 px-2.5 py-1">
            <FolderIcon className="shrink-0 text-ink-faint" width={15} height={15} />
            <input
              autoFocus
              className={`${controlClass} !py-1`}
              placeholder="Folder name…"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onBlur={commitNewFolder}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNewFolder()
                else if (e.key === 'Escape') {
                  setNewFolderName('')
                  setCreatingFolder(false)
                }
              }}
            />
          </div>
        )}

        {nothingSaved && !creatingFolder ? (
          <div className="px-2 py-3 text-[11px] text-ink-faint">No saved queries yet.</div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {sortedFolders.map(renderFolder)}

            {/* Root (un-foldered) queries — also the drop zone for "remove from folder" */}
            <div
              {...dropProps(null)}
              className={`mt-0.5 flex flex-col gap-0.5 rounded-[7px] ${
                dropTarget === null ? 'bg-green/10 ring-1 ring-green-dim' : ''
              }`}
            >
              {rootItems.map(renderItem)}
              {rootItems.length === 0 && (
                <div className="px-2.5 py-1 text-[11px] text-ink-faint">
                  {q ? 'No matches' : folders.length ? 'Drag queries out of folders here' : 'No saved queries.'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
