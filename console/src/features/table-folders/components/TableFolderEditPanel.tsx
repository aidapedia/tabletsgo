import { useState } from 'react'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { TrashIcon } from '@/shared/ui/icons'
import { FOLDER_COLORS, type TableFolder } from '../types'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { Input } from '@/shared/ui/input'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

/**
 * Edit a folder's name and color, or delete it. Presentational — the caller
 * wires `onSave` / `onDelete` to the folder API and its `folders` state. Opens
 * as a right-side slide-over (like the migration inspector / table editor),
 * from the schema diagram's folder region label.
 */
export default function TableFolderEditPanel({
  folder,
  onSave,
  onDelete,
  onClose,
}: {
  folder: TableFolder
  onSave: (fields: { name?: string; color?: string | null }) => void
  onDelete: () => void
  onClose: () => void
}) {
  const { show, close } = useSlideOver(onClose)
  const [name, setName] = useState(folder.name)
  const [color, setColor] = useState<string>(folder.color || FOLDER_COLORS[0])
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    close(() => {
      if (trimmed !== folder.name || color !== folder.color) onSave({ name: trimmed, color })
    })
  }

  return (
    <>
      <SlideOverPanel
        show={show}
        close={close}
        width={420}
        zClassName="z-[60]"
        footerClassName="justify-between"
        title={
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            Edit folder
          </span>
        }
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)} className="!text-destructive">
              <TrashIcon width={15} height={15} />
              Delete
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => close()}>
                Cancel
              </Button>
              <Button variant="default" size="sm" onClick={save} disabled={!name.trim()}>
                Save
              </Button>
            </div>
          </>
        }
      >
        <Label className="mb-2">Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="Folder name"
          autoFocus
        />

        <Label className="mb-2 mt-4">Color</Label>
        <div className="flex flex-wrap gap-1.5">
          {FOLDER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Color ${c}`}
              className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
                color === c ? 'border-foreground' : 'border-transparent'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        <p className="mt-4 text-[11px] text-faint">
          {folder.tables.length} table{folder.tables.length === 1 ? '' : 's'} in this folder.
        </p>
      </SlideOverPanel>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete folder “${folder.name}”?`}
          description="The folder is removed and its tables become ungrouped. Table data is not affected."
          confirmLabel="Delete folder"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => {
            setConfirmDelete(false)
            close(onDelete)
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}
