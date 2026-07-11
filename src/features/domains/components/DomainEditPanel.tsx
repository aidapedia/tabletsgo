import { useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import { Input } from '@/shared/ui/form/Input'
import { Label } from '@/shared/ui/form/Form'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { ChevronRight, TrashIcon } from '@/shared/ui/icons'
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
    <div
      className={`fixed inset-0 z-[60] flex justify-end bg-black/50 transition-opacity duration-200 ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseDown={() => close()}
    >
      <div
        className={`flex h-full w-full max-w-[420px] flex-col border-l border-edge-strong bg-panel shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.8)] transition-transform duration-200 ease-out ${
          show ? 'translate-x-0' : 'translate-x-full'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-edge px-5 py-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            Edit domain
          </h3>
          <IconButton size="lg" onClick={() => close()} aria-label="Close">
            <ChevronRight />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
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
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-edge px-5 py-4">
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
        </div>
      </div>

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
    </div>
  )
}
