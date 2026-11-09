import { useState } from 'react'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { toast } from 'sonner'
import { CheckIcon, CloseIcon, EditIcon, PlusIcon, TrashIcon } from '@/shared/ui/icons'
import { setTableFolder, createTableFolder, updateTableFolder, deleteTableFolder } from '../lib/api'
import { withTableAssignment } from '../lib/assign'
import { FOLDER_COLORS, type TableFolder } from '../types'
import { folderParentPath, foldersInTreeOrder } from '../lib/tree'
import FolderDot from './FolderDot'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

/** Row of selectable color swatches, shared by the create + inline-edit forms. */
function ColorSwatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {FOLDER_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`Color ${c}`}
          className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
            value === c ? 'border-foreground' : 'border-transparent'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  )
}

/**
 * Pick the single folder a table belongs to, shown as a right-side context
 * sidebar (slide-over). Self-contained: performs the folder API calls itself and
 * hands the parent the recomputed folder list via `onChange`, so the caller only
 * needs to `setFolders`. Choosing a folder reassigns the table (a table has at
 * most one folder); "No folder" clears it. Each folder row can be renamed /
 * recolored inline or deleted (with confirm); the footer form creates new ones.
 */
export default function TableFolderPickerPanel({
  connectionId,
  table,
  folders,
  onChange,
  onClose,
}: {
  connectionId: string
  table: string
  folders: TableFolder[]
  onChange: (next: TableFolder[]) => void
  onClose: () => void
}) {
  const { show, close } = useSlideOver(onClose)
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(FOLDER_COLORS[0])
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ id: string; name: string; color: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<TableFolder | null>(null)

  const currentId = folders.find((d) => d.tables.includes(table))?.id ?? null

  const assign = async (folderId: string | null) => {
    if (editing) return
    if (folderId === currentId) return close()
    const prev = folders
    onChange(withTableAssignment(folders, table, folderId))
    try {
      await setTableFolder(connectionId, table, folderId)
      close()
    } catch (e: any) {
      toast.error(`Couldn't set folder: ${e.message}`)
      onChange(prev)
    }
  }

  const remove = async (folder: TableFolder) => {
    const prev = folders
    onChange(folders.filter((d) => d.id !== folder.id))
    try {
      await deleteTableFolder(connectionId, folder.id)
    } catch (e: any) {
      toast.error(`Delete failed: ${e.message}`)
      onChange(prev)
    }
  }

  const saveEdit = async () => {
    if (!editing) return
    const trimmed = editing.name.trim()
    if (!trimmed) return
    const target = folders.find((d) => d.id === editing.id)
    if (!target || (trimmed === target.name && editing.color === target.color)) return setEditing(null)
    const prev = folders
    onChange(folders.map((d) => (d.id === editing.id ? { ...d, name: trimmed, color: editing.color } : d)))
    setEditing(null)
    try {
      await updateTableFolder(connectionId, editing.id, { name: trimmed, color: editing.color })
    } catch (e: any) {
      toast.error(`Couldn't update folder: ${e.message}`)
      onChange(prev)
    }
  }

  const add = async () => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const created = await createTableFolder(connectionId, { name: trimmed, color })
      await setTableFolder(connectionId, table, created.id)
      // New folder owns the table; strip it from any previous folder.
      onChange(withTableAssignment([...folders, { ...created, tables: [] }], table, created.id))
      toast.success(`Added to “${created.name}”.`)
      close()
    } catch (e: any) {
      toast.error(`Couldn't create folder: ${e.message}`)
      setBusy(false)
    }
  }

  const row = 'group flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left'

  return (
    <>
      <SlideOverPanel
        show={show}
        close={close}
        width={420}
        header={
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground">Set folder</h3>
            <p className="truncate text-[11px] text-faint">{table}</p>
          </div>
        }
      >
        <div className="flex flex-col gap-1.5">
          {/* No folder (clear) */}
          <button
            type="button"
            onClick={() => assign(null)}
            className={`${row} ${currentId === null ? 'border-primary bg-primary/10' : 'border-border bg-muted/40 hover:border-input'}`}
          >
            <FolderDot color={null} />
            <span className="flex-1 truncate text-xs text-muted-foreground">No folder</span>
            {currentId === null && <CheckIcon width={14} height={14} className="text-primary" />}
          </button>

          {folders.length === 0 ? (
            <EmptyState className="py-4">No folders yet. Create one below.</EmptyState>
          ) : (
            foldersInTreeOrder(folders).map((d) => {
              const selected = d.id === currentId
              const path = folderParentPath(folders, d)
              if (editing?.id === d.id) {
                return (
                  <div key={d.id} className="rounded-lg border border-input bg-muted/40 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Input
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit()
                          if (e.key === 'Escape') setEditing(null)
                        }}
                        placeholder="Folder name"
                        className="flex-1"
                        autoFocus
                      />
                      <Button variant="ghost" size="icon-xs" onClick={saveEdit} aria-label="Save" disabled={!editing.name.trim()}>
                        <CheckIcon width={14} height={14} className="text-primary" />
                      </Button>
                      <Button variant="ghost" size="icon-xs" onClick={() => setEditing(null)} aria-label="Cancel">
                        <CloseIcon width={14} height={14} />
                      </Button>
                    </div>
                    <div className="mt-2.5">
                      <ColorSwatches value={editing.color} onChange={(c) => setEditing({ ...editing, color: c })} />
                    </div>
                  </div>
                )
              }
              return (
                <div
                  key={d.id}
                  onClick={() => assign(d.id)}
                  className={`${row} cursor-pointer ${selected ? 'border-primary bg-primary/10' : 'border-border bg-muted/40 hover:border-input'}`}
                >
                  <FolderDot color={d.color} />
                  <span className="flex-1 truncate text-xs text-foreground" title={path ? `${path} / ${d.name}` : d.name}>
                    {path && <span className="text-faint">{path} / </span>}
                    {d.name}
                  </span>
                  <span className="text-[10px] text-faint">{d.tables.length}</span>
                  {selected && <CheckIcon width={14} height={14} className="text-primary" />}
                  <Button variant="ghost" size="icon-xs"
                    className="!text-faint opacity-0 hover:!text-foreground group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditing({ id: d.id, name: d.name, color: d.color || FOLDER_COLORS[0] })
                    }}
                    aria-label={`Edit folder ${d.name}`}
                  >
                    <EditIcon width={14} height={14} />
                  </Button>
                  <Button variant="ghost" size="icon-xs"
                    className="!text-faint opacity-0 hover:!text-destructive group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmDelete(d)
                    }}
                    aria-label={`Delete folder ${d.name}`}
                  >
                    <TrashIcon width={14} height={14} />
                  </Button>
                </div>
              )
            })
          )}
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">New folder</p>
          <div className="flex items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="Folder name"
              className="flex-1"
            />
            <Button variant="default" onClick={add} disabled={!name.trim() || busy}>
              <PlusIcon width={15} height={15} />
              Add
            </Button>
          </div>
          <div className="mt-3">
            <ColorSwatches value={color} onChange={setColor} />
          </div>
        </div>
      </SlideOverPanel>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete folder “${confirmDelete.name}”?`}
          description="The folder is removed and its tables become ungrouped. Table data is not affected."
          confirmLabel="Delete folder"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => {
            remove(confirmDelete)
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  )
}
