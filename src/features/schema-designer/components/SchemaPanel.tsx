import { useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  DiagramIcon,
  EditIcon,
  MoreVerticalIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
} from '@/shared/ui/icons'
import { controlClass } from '@/shared/ui/form/Input'
import IconButton from '@/shared/ui/buttons/IconButton'
import TextButton from '@/shared/ui/buttons/TextButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import RowLabel from '@/shared/ui/RowLabel'
import Popover from '@/shared/ui/overlay/Popover'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import { relativeTime } from '@/shared/lib/recents'
import { listSchemaMigrations } from '@/shared/api/database'

const rowBase = 'group flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-xs'
const rowIdle = 'text-ink-dim hover:bg-elevated hover:text-ink'

// Left-rail panel for the Schema rail icon — an accordion (one section open at
// a time, same pattern as the Tables/Views/Functions groups in the data
// browser): saved schema drafts, and the schema-version migration history.
export default function SchemaPanel({
  conn,
  refreshKey,
  drafts = [],
  onOpenDraft,
  onNewSchema,
  onRenameDraft,
  onDeleteDraft,
  onRefreshDrafts,
}: any) {
  const [openGroup, setOpenGroup] = useState('drafts') // 'drafts' | 'history'
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const [migrations, setMigrations] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  // Re-fetch on connection change and whenever refreshKey bumps (WorkspacePage
  // bumps it after every commit, so a new migration shows up automatically).
  useEffect(() => {
    let alive = true
    setLoadingHistory(true)
    listSchemaMigrations(conn).then((list) => {
      if (!alive) return
      setMigrations(list)
      setLoadingHistory(false)
    })
    return () => {
      alive = false
    }
  }, [conn, refreshKey])

  const sortedDrafts = useMemo(() => [...drafts].sort((a, b) => a.name.localeCompare(b.name)), [drafts])
  const toggleGroup = (g) => setOpenGroup((prev) => (prev === g ? null : g))

  const commitRename = () => {
    if (renaming?.value.trim()) onRenameDraft?.(renaming.id, renaming.value.trim())
    setRenaming(null)
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
        <span className="text-xs font-semibold">Schema</span>
        <div className="flex gap-1">
          <Tooltip label="Refresh" placement="bottom">
            <IconButton onClick={onRefreshDrafts} aria-label="Refresh">
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

      {/* One scroll container so sections size to their content (no big gap
          from an empty open section pushing the next header to the bottom). */}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-4 pt-1">
        {/* Drafts */}
        <div className="flex shrink-0 flex-col">
          <TextButton
            tone="faint"
            className="w-full shrink-0 rounded-[6px] px-1.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide hover:!text-ink-dim"
            onClick={() => toggleGroup('drafts')}
          >
            <ChevronRight width={12} height={12} className={`transition-transform ${openGroup === 'drafts' ? 'rotate-90' : ''}`} />
            Drafts <span className="opacity-60">{sortedDrafts.length}</span>
          </TextButton>
          {openGroup === 'drafts' && (
            <div className="flex flex-col gap-0.5 pr-0.5">
              {sortedDrafts.length === 0 ? (
                <div className="px-2.5 py-1.5 text-[11px] text-ink-faint">No schema drafts yet.</div>
              ) : (
                sortedDrafts.map((d: any) =>
                  renaming?.id === d.id ? (
                    <div key={d.id} className="flex items-center gap-2 px-2.5 py-1">
                      <DiagramIcon className="shrink-0 text-ink-faint" width={14} height={14} />
                      <input
                        autoFocus
                        className={`${controlClass} !py-1`}
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
                      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Popover
                          align="right"
                          width={170}
                          trigger={({ open, toggle }) => (
                            <IconButton
                              size="sm"
                              active={open}
                              onClick={toggle}
                              aria-label="Draft actions"
                              className={open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                            >
                              <MoreVerticalIcon width={15} height={15} />
                            </IconButton>
                          )}
                        >
                          {({ close }) => (
                            <div className="p-1">
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
              )}
            </div>
          )}
        </div>

        {/* History — audit trail only, no revert action by design. */}
        <div className="flex shrink-0 flex-col">
          <TextButton
            tone="faint"
            className="w-full shrink-0 rounded-[6px] px-1.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide hover:!text-ink-dim"
            onClick={() => toggleGroup('history')}
          >
            <ChevronRight width={12} height={12} className={`transition-transform ${openGroup === 'history' ? 'rotate-90' : ''}`} />
            History <span className="opacity-60">{migrations.length}</span>
          </TextButton>
          {openGroup === 'history' && (
            <div className="flex flex-col gap-2 pr-0.5">
              {loadingHistory ? (
                <div className="px-2.5 py-1.5 text-[11px] text-ink-faint">Loading…</div>
              ) : migrations.length === 0 ? (
                <div className="px-2.5 py-1.5 text-[11px] text-ink-faint">
                  No schema changes committed yet — DDL commits show up here with their version.
                </div>
              ) : (
                migrations.map((m: any) => (
                  <div key={m.id} className="rounded-soft border border-edge bg-card px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-green/15 px-1.5 py-0.5 text-[10px] font-bold text-green-bright">
                        v{m.version}
                      </span>
                      <span className="truncate text-[10px] text-ink-dim">{m.executorName || 'Unknown'}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-ink-faint">{relativeTime(m.ts)}</span>
                    </div>
                    <pre className="mt-1.5 overflow-x-auto rounded-soft border border-edge bg-bg px-2 py-1.5 font-mono text-[10px] leading-[1.6] text-ink-dim">
                      {m.forwardSql.join('\n')}
                    </pre>
                    {m.reversible ? (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-[10px] font-medium text-ink-faint hover:text-ink-dim">
                          Rollback SQL
                        </summary>
                        <pre className="mt-1.5 overflow-x-auto rounded-soft border border-edge bg-bg px-2 py-1.5 font-mono text-[10px] leading-[1.6] text-ink-dim">
                          {m.rollbackSql.filter(Boolean).join('\n')}
                        </pre>
                      </details>
                    ) : (
                      <div className="mt-1.5 text-[10px] text-ink-faint">Not reversible (data was deleted).</div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
