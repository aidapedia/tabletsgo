import { useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import { Input } from '@/shared/ui/form/Input'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CheckIcon, CloseIcon, EditIcon, PlusIcon, TrashIcon } from '@/shared/ui/icons'
import { setTableDomain, createDomain, updateDomain, deleteDomain } from '../lib/api'
import { withTableAssignment } from '../lib/assign'
import { DOMAIN_COLORS, type Domain } from '../types'
import DomainDot from './DomainDot'

/** Row of selectable color swatches, shared by the create + inline-edit forms. */
function ColorSwatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {DOMAIN_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`Color ${c}`}
          className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
            value === c ? 'border-ink' : 'border-transparent'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  )
}

/**
 * Pick the single domain a table belongs to, shown as a right-side context
 * sidebar (slide-over). Self-contained: performs the domain API calls itself and
 * hands the parent the recomputed domain list via `onChange`, so the caller only
 * needs to `setDomains`. Choosing a domain reassigns the table (a table has at
 * most one domain); "No domain" clears it. Each domain row can be renamed /
 * recolored inline or deleted (with confirm); the footer form creates new ones.
 */
export default function DomainPickerPanel({
  connectionId,
  table,
  domains,
  onChange,
  onClose,
}: {
  connectionId: string
  table: string
  domains: Domain[]
  onChange: (next: Domain[]) => void
  onClose: () => void
}) {
  const { show, close } = useSlideOver(onClose)
  const toast = useToast()
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(DOMAIN_COLORS[0])
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ id: string; name: string; color: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Domain | null>(null)

  const currentId = domains.find((d) => d.tables.includes(table))?.id ?? null

  const assign = async (domainId: string | null) => {
    if (editing) return
    if (domainId === currentId) return close()
    const prev = domains
    onChange(withTableAssignment(domains, table, domainId))
    try {
      await setTableDomain(connectionId, table, domainId)
      close()
    } catch (e: any) {
      toast.error(`Couldn't set domain: ${e.message}`)
      onChange(prev)
    }
  }

  const remove = async (domain: Domain) => {
    const prev = domains
    onChange(domains.filter((d) => d.id !== domain.id))
    try {
      await deleteDomain(connectionId, domain.id)
    } catch (e: any) {
      toast.error(`Delete failed: ${e.message}`)
      onChange(prev)
    }
  }

  const saveEdit = async () => {
    if (!editing) return
    const trimmed = editing.name.trim()
    if (!trimmed) return
    const target = domains.find((d) => d.id === editing.id)
    if (!target || (trimmed === target.name && editing.color === target.color)) return setEditing(null)
    const prev = domains
    onChange(domains.map((d) => (d.id === editing.id ? { ...d, name: trimmed, color: editing.color } : d)))
    setEditing(null)
    try {
      await updateDomain(connectionId, editing.id, { name: trimmed, color: editing.color })
    } catch (e: any) {
      toast.error(`Couldn't update domain: ${e.message}`)
      onChange(prev)
    }
  }

  const add = async () => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const created = await createDomain(connectionId, { name: trimmed, color })
      await setTableDomain(connectionId, table, created.id)
      // New domain owns the table; strip it from any previous domain.
      onChange(withTableAssignment([...domains, { ...created, tables: [] }], table, created.id))
      toast.success(`Added to “${created.name}”.`)
      close()
    } catch (e: any) {
      toast.error(`Couldn't create domain: ${e.message}`)
      setBusy(false)
    }
  }

  const row = 'group flex w-full items-center gap-2.5 rounded-soft border px-3 py-2 text-left'

  return (
    <>
      <SlideOverPanel
        show={show}
        close={close}
        width={420}
        header={
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-ink">Set domain</h3>
            <p className="truncate text-[11px] text-ink-faint">{table}</p>
          </div>
        }
      >
        <div className="flex flex-col gap-1.5">
          {/* No domain (clear) */}
          <button
            type="button"
            onClick={() => assign(null)}
            className={`${row} ${currentId === null ? 'border-green bg-green/10' : 'border-edge bg-elevated/40 hover:border-edge-strong'}`}
          >
            <DomainDot color={null} />
            <span className="flex-1 truncate text-xs text-ink-dim">No domain</span>
            {currentId === null && <CheckIcon width={14} height={14} className="text-green" />}
          </button>

          {domains.length === 0 ? (
            <EmptyState className="py-4">No domains yet. Create one below.</EmptyState>
          ) : (
            domains.map((d) => {
              const selected = d.id === currentId
              if (editing?.id === d.id) {
                return (
                  <div key={d.id} className="rounded-soft border border-edge-strong bg-elevated/40 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Input
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit()
                          if (e.key === 'Escape') setEditing(null)
                        }}
                        placeholder="Domain name"
                        className="flex-1"
                        autoFocus
                      />
                      <IconButton size="sm" onClick={saveEdit} aria-label="Save" disabled={!editing.name.trim()}>
                        <CheckIcon width={14} height={14} className="text-green" />
                      </IconButton>
                      <IconButton size="sm" onClick={() => setEditing(null)} aria-label="Cancel">
                        <CloseIcon width={14} height={14} />
                      </IconButton>
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
                  className={`${row} cursor-pointer ${selected ? 'border-green bg-green/10' : 'border-edge bg-elevated/40 hover:border-edge-strong'}`}
                >
                  <DomainDot color={d.color} />
                  <span className="flex-1 truncate text-xs text-ink">{d.name}</span>
                  <span className="text-[10px] text-ink-faint">{d.tables.length}</span>
                  {selected && <CheckIcon width={14} height={14} className="text-green" />}
                  <IconButton
                    size="sm"
                    className="!text-ink-faint opacity-0 hover:!text-ink group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditing({ id: d.id, name: d.name, color: d.color || DOMAIN_COLORS[0] })
                    }}
                    aria-label={`Edit domain ${d.name}`}
                  >
                    <EditIcon width={14} height={14} />
                  </IconButton>
                  <IconButton
                    size="sm"
                    className="!text-ink-faint opacity-0 hover:!text-red group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmDelete(d)
                    }}
                    aria-label={`Delete domain ${d.name}`}
                  >
                    <TrashIcon width={14} height={14} />
                  </IconButton>
                </div>
              )
            })
          )}
        </div>

        <div className="mt-5 border-t border-edge pt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">New domain</p>
          <div className="flex items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="Domain name"
              className="flex-1"
            />
            <Button variant="primary" icon={PlusIcon} onClick={add} disabled={!name.trim() || busy}>
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
          title={`Delete domain “${confirmDelete.name}”?`}
          message="The domain is removed and its tables become ungrouped. Table data is not affected."
          confirmLabel="Delete domain"
          cancelLabel="Cancel"
          danger
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
