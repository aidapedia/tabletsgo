import { useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import { Input } from '@/shared/ui/form/Input'
import { Label } from '@/shared/ui/form/Form'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { TrashIcon } from '@/shared/ui/icons'
import { DOMAIN_COLORS, type Domain } from '../types'

/**
 * Edit a domain's name and color, or delete it. Presentational — the caller
 * wires `onSave` / `onDelete` to the domain API and its `domains` state. Opens
 * as a right-side slide-over (like the migration inspector / table editor),
 * from the schema diagram's domain region label.
 */
export default function DomainEditPanel({
  domain,
  onSave,
  onDelete,
  onClose,
}: {
  domain: Domain
  onSave: (fields: { name?: string; color?: string | null }) => void
  onDelete: () => void
  onClose: () => void
}) {
  const { show, close } = useSlideOver(onClose)
  const [name, setName] = useState(domain.name)
  const [color, setColor] = useState<string>(domain.color || DOMAIN_COLORS[0])
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    close(() => {
      if (trimmed !== domain.name || color !== domain.color) onSave({ name: trimmed, color })
      onClose()
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
            Edit domain
          </span>
        }
        footer={
          <>
            <Button variant="ghost" size="sm" icon={TrashIcon} onClick={() => setConfirmDelete(true)} className="!text-red">
              Delete
            </Button>
            <div className="flex gap-2">
              <Button variant="subtle" size="sm" onClick={() => close()}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={save} disabled={!name.trim()}>
                Save
              </Button>
            </div>
          </>
        }
      >
        <Label>Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="Domain name"
          autoFocus
        />

        <Label className="mt-4">Color</Label>
        <div className="flex flex-wrap gap-1.5">
          {DOMAIN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Color ${c}`}
              className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
                color === c ? 'border-ink' : 'border-transparent'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        <p className="mt-4 text-[11px] text-ink-faint">
          {domain.tables.length} table{domain.tables.length === 1 ? '' : 's'} in this domain.
        </p>
      </SlideOverPanel>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete domain “${domain.name}”?`}
          message="The domain is removed and its tables become ungrouped. Table data is not affected."
          confirmLabel="Delete domain"
          cancelLabel="Cancel"
          danger
          onConfirm={() => {
            setConfirmDelete(false)
            close(() => {
              onDelete()
              onClose()
            })
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}
