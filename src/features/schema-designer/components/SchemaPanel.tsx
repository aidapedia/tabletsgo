import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, DiagramIcon, EditIcon, EyeIcon, HistoryIcon, MoreVerticalIcon, PlusIcon, RefreshIcon, TagIcon, TrashIcon } from '@/shared/ui/icons'
import { Input } from '@/shared/ui/form/Input'
import Badge from '@/shared/ui/Badge'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import IconButton from '@/shared/ui/buttons/IconButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import RowLabel from '@/shared/ui/RowLabel'
import TextButton from '@/shared/ui/buttons/TextButton'
import Popover from '@/shared/ui/overlay/Popover'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import MigrationInspector, { canRollbackTo, fmtTime } from './MigrationInspector'
import { buildDraftMigration } from '../lib/rollback'

const rowBase = 'group flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-xs'
const rowIdle = 'text-ink-dim hover:bg-elevated hover:text-ink'

// Accordion section header — one open section at a time, styled to match the
// console data-browser sections (Tables / Views / Functions). Keeps the title +
// count visible even when the section is collapsed or empty.
function SectionHeader({ open, label, count, onToggle }: any) {
  return (
    <TextButton
      tone="faint"
      className="w-full shrink-0 rounded-[6px] px-1.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide hover:!text-ink-dim"
      onClick={onToggle}
    >
      <ChevronRight width={12} height={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      {label} <span className="opacity-60">{count}</span>
    </TextButton>
  )
}

// Left-rail panel for the Schema rail icon. Presents schema versions GitHub-style:
// local, uncommitted schema editors are "drafts"; committed DDL migrations are
// "releases" (changes already applied to the database). Drafts and Releases are
// an accordion (one open at a time), each release exposing an inspector (Up/Down
// SQL) and a rollback action via its hover kebab.
export default function SchemaPanel({
  conn,
  drafts = [],
  migrations = [],
  dialect,
  onOpenDraft,
  onNewSchema,
  onRenameDraft,
  onDeleteDraft,
  onRefreshDrafts,
  onRefreshMigrations,
  onRollback,
}: any) {
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const [inspecting, setInspecting] = useState<any>(null) // migration shown in the inspector slide-over
  const [inspectingDraft, setInspectingDraft] = useState<any>(null) // draft shown in the inspector slide-over
  const [open, setOpen] = useState('drafts') // which accordion section is expanded
  const toggle = (k: string) => setOpen((p) => (p === k ? null : k))

  // Load (or reload) the migration list whenever the panel mounts.
  useEffect(() => {
    onRefreshMigrations?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sortedDrafts = useMemo(() => [...drafts].sort((a, b) => a.name.localeCompare(b.name)), [drafts])
  // Releases newest-first (highest version at the top).
  const releases = useMemo(() => [...migrations].sort((a, b) => b.version - a.version), [migrations])

  const commitRename = () => {
    if (renaming?.value.trim()) onRenameDraft?.(renaming.id, renaming.value.trim())
    setRenaming(null)
  }

  const refreshAll = () => {
    onRefreshDrafts?.()
    onRefreshMigrations?.()
  }

  // Build the draft's Up/Down SQL (DROP TABLE reconstruction needs a live column
  // snapshot, so this is async) and open the inspector on it.
  const openDraftInspector = async (d: any) => {
    const migration = await buildDraftMigration(conn, d.sql)
    setInspectingDraft({ name: d.name, migration })
  }

  const sections = [
    { key: 'drafts', label: 'Drafts', count: sortedDrafts.length },
    { key: 'releases', label: 'Releases', count: releases.length },
  ]

  return (
    <>
      <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
        <span className="text-xs font-semibold">Schema Versions</span>
        <div className="flex gap-1">
          <Tooltip label="Refresh" placement="bottom">
            <IconButton onClick={refreshAll} aria-label="Refresh">
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Tooltip label="New schema editor" placement="bottom">
            <IconButton onClick={onNewSchema} aria-label="New schema editor">
              <PlusIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden px-2 pb-2 pt-1">
        {sections.map((s) => {
          const isOpen = open === s.key
          return (
            <div key={s.key} className={`flex min-h-0 flex-col ${isOpen ? 'flex-1' : 'shrink-0'}`}>
              <SectionHeader open={isOpen} label={s.label} count={s.count} onToggle={() => toggle(s.key)} />
              {isOpen && (
                <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-0.5 pt-1">
                  {/* ---- Drafts: local, uncommitted schema editors ---- */}
                  {s.key === 'drafts' &&
                    (sortedDrafts.length === 0 ? (
                      <EmptyState className="py-6">No drafts yet.</EmptyState>
                    ) : (
                      sortedDrafts.map((d: any) =>
                        renaming?.id === d.id ? (
                          <div key={d.id} className="flex items-center gap-2 px-2.5 py-1">
                            <DiagramIcon className="shrink-0 text-ink-faint" width={14} height={14} />
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
                        ) : (
                          <div key={d.id} className={`${rowBase} cursor-pointer ${rowIdle}`}>
                            <DiagramIcon className="shrink-0 text-ink-faint" width={14} height={14} />
                            <RowLabel onClick={() => onOpenDraft?.(d)}>{d.name}</RowLabel>
                            <Badge tone="amber" dense>draft</Badge>
                            <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                              <Popover
                                align="right"
                                width={170}
                                trigger={({ open: pop, toggle: t }) => (
                                  <IconButton
                                    size="sm"
                                    active={pop}
                                    onClick={t}
                                    aria-label="Draft actions"
                                    className={pop ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                                  >
                                    <MoreVerticalIcon width={15} height={15} />
                                  </IconButton>
                                )}
                              >
                                {({ close }) => (
                                  <div className="p-1">
                                    <MenuItem onClick={() => { openDraftInspector(d); close() }}>
                                      <EyeIcon width={14} height={14} /> Open Inspector
                                    </MenuItem>
                                    <div className="my-1 h-px bg-edge" />
                                    <MenuItem onClick={() => { setRenaming({ id: d.id, value: d.name }); close() }}>
                                      <EditIcon width={14} height={14} /> Rename
                                    </MenuItem>
                                    <div className="my-1 h-px bg-edge" />
                                    <MenuItem danger onClick={() => { onDeleteDraft?.(d.id); close() }}>
                                      <TrashIcon width={14} height={14} /> Delete
                                    </MenuItem>
                                  </div>
                                )}
                              </Popover>
                            </div>
                          </div>
                        )
                      )
                    ))}

                  {/* ---- Releases: committed DDL migrations (applied to the database) ---- */}
                  {s.key === 'releases' &&
                    (releases.length === 0 ? (
                      <EmptyState className="py-6">No releases yet — DDL commits show up here.</EmptyState>
                    ) : (
                      releases.map((m: any) => {
                        const rolledBack = (m.status || 'active') === 'rollbacked'
                        const canRollback = canRollbackTo(migrations, m)
                        return (
                          <div key={m.id} className={`${rowBase} cursor-pointer ${rowIdle}`} onClick={() => setInspecting(m)}>
                            <TagIcon className={`shrink-0 ${rolledBack ? 'text-ink-faint' : 'text-green-bright'}`} width={14} height={14} />
                            <div className="flex min-w-0 flex-1 flex-col">
                              <span className={`flex items-center gap-1.5 font-medium ${rolledBack ? 'text-ink-faint' : 'text-ink'}`}>
                                v{m.version}
                                <Badge tone={rolledBack ? 'faint' : 'green'} dense>{rolledBack ? 'rolled back' : 'release'}</Badge>
                              </span>
                              <span className="truncate text-[10px] text-ink-faint">{fmtTime(m.ts)}</span>
                            </div>
                            <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                              <Popover
                                align="right"
                                width={210}
                                trigger={({ open: pop, toggle: t }) => (
                                  <IconButton
                                    size="sm"
                                    active={pop}
                                    onClick={t}
                                    aria-label="Release actions"
                                    className={pop ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                                  >
                                    <MoreVerticalIcon width={15} height={15} />
                                  </IconButton>
                                )}
                              >
                                {({ close }) => (
                                  <div className="p-1">
                                    <MenuItem onClick={() => { setInspecting(m); close() }}>
                                      <EyeIcon width={14} height={14} /> Open Inspector
                                    </MenuItem>
                                    <div className="my-1 h-px bg-edge" />
                                    <MenuItem
                                      disabled={!canRollback}
                                      title={
                                        canRollback
                                          ? 'Roll the schema back to this version.'
                                          : rolledBack
                                            ? 'Already rolled back.'
                                            : 'Current version — nothing newer to roll back.'
                                      }
                                      onClick={() => { onRollback?.(m); close() }}
                                    >
                                      <HistoryIcon width={14} height={14} /> Roll back to this version
                                    </MenuItem>
                                  </div>
                                )}
                              </Popover>
                            </div>
                          </div>
                        )
                      })
                    ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {inspecting && (
        <MigrationInspector
          migration={inspecting}
          dialect={dialect}
          canRollback={canRollbackTo(migrations, inspecting)}
          onClose={() => setInspecting(null)}
          onRollback={(m) => {
            setInspecting(null)
            onRollback?.(m)
          }}
        />
      )}

      {inspectingDraft && (
        <MigrationInspector
          variant="draft"
          name={inspectingDraft.name}
          migration={inspectingDraft.migration}
          dialect={dialect}
          onClose={() => setInspectingDraft(null)}
        />
      )}
    </>
  )
}
