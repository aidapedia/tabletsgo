import { useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import { Input } from '@/shared/ui/form/Input'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CheckIcon, CloseIcon, PlusIcon, TrashIcon } from '@/shared/ui/icons'
import { setTableDomain, createDomain, deleteDomain } from '../lib/api'
import { DOMAIN_COLORS, type Domain } from '../types'
import DomainDot from './DomainDot'

/**
 * Pick the single domain a table belongs to. Self-contained: performs the
 * domain API calls itself and hands the parent the recomputed domain list via
 * `onChange`, so the caller only needs to `setDomains`. Choosing a domain
 * reassigns the table (a table has at most one domain); "No domain" clears it.
 */
export default function DomainPickerModal({
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
  const toast = useToast()
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(DOMAIN_COLORS[0])
  const [busy, setBusy] = useState(false)

  const currentId = domains.find((d) => d.tables.includes(table))?.id ?? null

  // Move `table` out of every domain, then into `domainId` (null = none).
  const withAssignment = (list: Domain[], domainId: string | null) =>
    list.map((d) => ({
      ...d,
      tables: d.id === domainId ? [...d.tables.filter((n) => n !== table), table] : d.tables.filter((n) => n !== table),
    }))

  const assign = async (domainId: string | null) => {
    if (domainId === currentId) return onClose()
    const prev = domains
    onChange(withAssignment(domains, domainId))
    try {
      await setTableDomain(connectionId, table, domainId)
      onClose()
    } catch (e: any) {
      toast.error(`Couldn't set domain: ${e.message}`)
      onChange(prev)
    }
  }

  const remove = async (domain: Domain) => {
    onChange(domains.filter((d) => d.id !== domain.id))
    try {
      await deleteDomain(connectionId, domain.id)
    } catch (e: any) {
      toast.error(`Delete failed: ${e.message}`)
      onChange(domains)
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
      onChange(withAssignment([...domains, { ...created, tables: [] }], created.id))
      toast.success(`Added to “${created.name}”.`)
      onClose()
    } catch (e: any) {
      toast.error(`Couldn't create domain: ${e.message}`)
      setBusy(false)
    }
  }

  const row = 'group flex w-full cursor-pointer items-center gap-2.5 rounded-soft border px-3 py-2 text-left'

  return (
    <div className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]" onClick={onClose}>
      <div
        className="w-full max-w-[420px] animate-pop rounded-[16px] border border-edge-strong bg-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-ink">Set domain</h3>
            <p className="truncate text-[11px] text-ink-faint">{table}</p>
          </div>
          <IconButton onClick={onClose} aria-label="Close">
            <CloseIcon width={15} height={15} />
          </IconButton>
        </div>

        <div className="max-h-[46vh] overflow-y-auto px-5 py-4">
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
                return (
                  <div
                    key={d.id}
                    onClick={() => assign(d.id)}
                    className={`${row} ${selected ? 'border-green bg-green/10' : 'border-edge bg-elevated/40 hover:border-edge-strong'}`}
                  >
                    <DomainDot color={d.color} />
                    <span className="flex-1 truncate text-xs text-ink">{d.name}</span>
                    <span className="text-[10px] text-ink-faint">{d.tables.length}</span>
                    {selected && <CheckIcon width={14} height={14} className="text-green" />}
                    <IconButton
                      size="sm"
                      className="!text-ink-faint opacity-0 hover:!text-red group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation()
                        remove(d)
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
        </div>

        <div className="border-t border-edge px-5 py-4">
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
          <div className="mt-3 flex flex-wrap gap-1.5">
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
        </div>
      </div>
    </div>
  )
}
