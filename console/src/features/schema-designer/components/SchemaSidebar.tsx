import { useState } from 'react'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import { ChevronRight, TableIcon, TrashIcon } from '@/shared/ui/icons'
import { FolderDot } from '@/features/table-folders'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Checkbox } from '@/shared/ui/checkbox'

// Accordion section header — one open section at a time, like the console
// browser sidebar.
function SectionHeader({ open, label, count, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full shrink-0 items-center gap-1.5 px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-faint hover:text-muted-foreground"
    >
      <ChevronRight width={12} height={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      <span className="flex-1 truncate">{label}</span>
      <span className="opacity-60">{count}</span>
    </button>
  )
}

const rowClass = 'group flex w-full cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground'

// Map a staged change's mode to an operation badge (add / alter / drop). Falls
// back to sniffing the SQL verb so unknown modes still get a sensible badge.
const OP_BY_MODE = {
  new: { label: 'add', tone: 'default' },
  create: { label: 'add', tone: 'default' },
  'fk-add': { label: 'add', tone: 'default' },
  edit: { label: 'alter', tone: 'warning' },
  'fk-edit': { label: 'alter', tone: 'warning' },
  delete: { label: 'drop', tone: 'destructive' },
  'fk-drop': { label: 'drop', tone: 'destructive' },
}
function opBadge(p) {
  if (OP_BY_MODE[p.mode]) return OP_BY_MODE[p.mode]
  const sql = (p.sql || '').trimStart().toUpperCase()
  if (sql.startsWith('CREATE')) return { label: 'add', tone: 'default' }
  if (sql.startsWith('DROP')) return { label: 'drop', tone: 'destructive' }
  if (sql.startsWith('ALTER')) return { label: 'alter', tone: 'warning' }
  return { label: p.mode || 'ddl', tone: 'warning' }
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
    <aside className="app-sidebar flex h-full w-[240px] shrink-0 flex-col border-r border-border bg-sidebar">
      {sections.map((s) => {
        const isOpen = open === s.key
        return (
          <div key={s.key} className={`flex min-h-0 flex-col border-b border-border ${isOpen ? 'flex-1' : 'shrink-0'}`}>
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
                        <Badge variant={op.tone} size="dense">{op.label}</Badge>
                        <span className="flex-1 truncate font-mono text-[11px]">{p.sql}</span>
                        <Button variant="ghost" size="icon-xs"
                          className="!text-faint opacity-0 hover:!text-destructive group-hover:opacity-100"
                          onClick={(e) => { e.stopPropagation(); onRemovePending(p.id) }}
                          aria-label="Discard change"
                        >
                          <TrashIcon width={13} height={13} />
                        </Button>
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
                      className="mx-0.5 mb-1 rounded-lg border border-border bg-muted px-2 py-1.5 text-[11px] text-foreground outline-none placeholder:text-faint focus:border-primary/25"
                    />
                    {filteredTables.map((t) => {
                      const hidden = hiddenTables.has(t.name)
                      return (
                        <div key={t.name} className={rowClass} onClick={() => onFocusTable(t.name)}>
                          <div onClick={(e) => e.stopPropagation()}>
                            <Checkbox onClick={(e) => e.stopPropagation()} checked={!hidden} onCheckedChange={() => onToggleTable(t.name)} aria-label={`Toggle ${t.name}`} />
                          </div>
                          <TableIcon width={14} height={14} className="shrink-0 text-faint" />
                          <span className={`flex-1 truncate ${hidden ? 'opacity-40' : ''}`}>{t.name}</span>
                          <span className="text-[10px] text-faint">{t.columns.length}</span>
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
                          <span className="text-foreground">{fk.table}</span>
                          <span className="text-faint">.{fk.column}</span>
                          <span className="text-faint"> → </span>
                          <span className="text-foreground">{fk.refTable}</span>
                          <span className="text-faint">.{fk.refColumn}</span>
                        </span>
                        {fk.removed ? <Badge variant="destructive" size="dense">drop</Badge> : fk.pendingFk ? <Badge variant="default" size="dense">add</Badge> : null}
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
                        <span className="text-[10px] text-faint">{d.tables.length}</span>
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
