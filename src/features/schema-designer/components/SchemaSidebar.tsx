import { useState } from 'react'
import Checkbox from '@/shared/ui/form/Checkbox'
import Badge from '@/shared/ui/Badge'
import IconButton from '@/shared/ui/buttons/IconButton'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import { ChevronRight, TableIcon, TrashIcon } from '@/shared/ui/icons'
import { FolderDot } from '@/features/table-folders'

// Accordion section header — one open section at a time, like the console
// browser sidebar.
function SectionHeader({ open, label, count, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full shrink-0 items-center gap-1.5 px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink-faint hover:text-ink-dim"
    >
      <ChevronRight width={12} height={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      <span className="flex-1 truncate">{label}</span>
      <span className="opacity-60">{count}</span>
    </button>
  )
}

const rowClass = 'group flex w-full cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-xs text-ink-dim hover:bg-elevated hover:text-ink'

// Map a staged change's mode to an operation badge (add / alter / drop). Falls
// back to sniffing the SQL verb so unknown modes still get a sensible badge.
const OP_BY_MODE = {
  new: { label: 'add', tone: 'green' },
  create: { label: 'add', tone: 'green' },
  'fk-add': { label: 'add', tone: 'green' },
  edit: { label: 'alter', tone: 'amber' },
  'fk-edit': { label: 'alter', tone: 'amber' },
  delete: { label: 'drop', tone: 'red' },
  'fk-drop': { label: 'drop', tone: 'red' },
}
function opBadge(p) {
  if (OP_BY_MODE[p.mode]) return OP_BY_MODE[p.mode]
  const sql = (p.sql || '').trimStart().toUpperCase()
  if (sql.startsWith('CREATE')) return { label: 'add', tone: 'green' }
  if (sql.startsWith('DROP')) return { label: 'drop', tone: 'red' }
  if (sql.startsWith('ALTER')) return { label: 'alter', tone: 'amber' }
  return { label: p.mode || 'ddl', tone: 'amber' }
}

/**
 * Left sidebar for the schema diagram — an accordion of Draft Schema (staged
 * changes), Table List, References (FKs) and Table Folders. Clicking a table or
 * folder focuses the diagram on it; clicking a reference focuses it and opens
 * its edit popup (wired via the callbacks).
 */
export default function SchemaSidebar({
  pending,
  onRemovePending,
  tables,
  hiddenTables,
  onToggleTable,
  onFocusTable,
  foreignKeys,
  onEditReference,
  folders,
  onFocusFolder,
}) {
  const [open, setOpen] = useState('tables')
  const [q, setQ] = useState('')
  const toggle = (k) => setOpen((p) => (p === k ? null : k))

  const sortedTables = [...tables].sort((a, b) => a.name.localeCompare(b.name))
  const filteredTables = sortedTables.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()))

  const sections = [
    { key: 'draft', label: 'Schema Changes', count: pending.length },
    { key: 'tables', label: 'Table List', count: tables.length },
    { key: 'refs', label: 'References Key', count: foreignKeys.length },
    { key: 'folders', label: 'Table Folders', count: folders.length },
  ]

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-edge bg-panel">
      {sections.map((s) => {
        const isOpen = open === s.key
        return (
          <div key={s.key} className={`flex min-h-0 flex-col border-b border-edge ${isOpen ? 'flex-1' : 'shrink-0'}`}>
            <SectionHeader open={isOpen} label={s.label} count={s.count} onToggle={() => toggle(s.key)} />
            {isOpen && (
              <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1.5 pb-2">
                {s.key === 'draft' &&
                  (pending.length === 0 ? (
                    <EmptyState className="py-6">No staged changes.</EmptyState>
                  ) : (
                    pending.map((p) => {
                      const op = opBadge(p)
                      return (
                      <div key={p.id} className={rowClass} onClick={() => p.table && onFocusTable(p.table)} title={p.sql}>
                        <Badge tone={op.tone} dense>{op.label}</Badge>
                        <span className="flex-1 truncate font-mono text-[11px]">{p.sql}</span>
                        <IconButton
                          size="sm"
                          className="!text-ink-faint opacity-0 hover:!text-red group-hover:opacity-100"
                          onClick={(e) => { e.stopPropagation(); onRemovePending(p.id) }}
                          aria-label="Discard change"
                        >
                          <TrashIcon width={13} height={13} />
                        </IconButton>
                      </div>
                      )
                    })
                  ))}

                {s.key === 'tables' && (
                  <>
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Search tables…"
                      className="mx-0.5 mb-1 rounded-soft border border-edge bg-elevated px-2 py-1.5 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-green-dim"
                    />
                    {filteredTables.map((t) => {
                      const hidden = hiddenTables.has(t.name)
                      return (
                        <div key={t.name} className={rowClass} onClick={() => onFocusTable(t.name)}>
                          <div onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={!hidden} onChange={() => onToggleTable(t.name)} ariaLabel={`Toggle ${t.name}`} />
                          </div>
                          <TableIcon width={14} height={14} className="shrink-0 text-ink-faint" />
                          <span className={`flex-1 truncate ${hidden ? 'opacity-40' : ''}`}>{t.name}</span>
                          <span className="text-[10px] text-ink-faint">{t.columns.length}</span>
                        </div>
                      )
                    })}
                    {filteredTables.length === 0 && <EmptyState className="py-4">No tables match.</EmptyState>}
                  </>
                )}

                {s.key === 'refs' &&
                  (foreignKeys.length === 0 ? (
                    <EmptyState className="py-6">No foreign keys.</EmptyState>
                  ) : (
                    foreignKeys.map((fk, i) => (
                      <div
                        key={`${fk.constraint || 'pending'}:${fk.table}.${fk.column}:${i}`}
                        className={rowClass}
                        onClick={() => onEditReference(fk, i)}
                        title={`${fk.table}.${fk.column} → ${fk.refTable}.${fk.refColumn}`}
                      >
                        <span className={`flex-1 truncate ${fk.removed ? 'line-through opacity-50' : ''}`}>
                          <span className="text-ink">{fk.table}</span>
                          <span className="text-ink-faint">.{fk.column}</span>
                          <span className="text-ink-faint"> → </span>
                          <span className="text-ink">{fk.refTable}</span>
                          <span className="text-ink-faint">.{fk.refColumn}</span>
                        </span>
                        {fk.removed ? <Badge tone="red" dense>drop</Badge> : fk.pendingFk ? <Badge tone="green" dense>add</Badge> : null}
                      </div>
                    ))
                  ))}

                {s.key === 'folders' &&
                  (folders.length === 0 ? (
                    <EmptyState className="py-6">No folders yet.</EmptyState>
                  ) : (
                    folders.map((d) => (
                      <div key={d.id} className={rowClass} onClick={() => onFocusFolder(d)}>
                        <FolderDot color={d.color} />
                        <span className="flex-1 truncate">{d.name}</span>
                        <span className="text-[10px] text-ink-faint">{d.tables.length}</span>
                      </div>
                    ))
                  ))}
              </div>
            )}
          </div>
        )
      })}
    </aside>
  )
}
