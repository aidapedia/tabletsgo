import { useMemo, useState } from 'react'
import { DiagramIcon, EditIcon, MoreVerticalIcon, PlusIcon, RefreshIcon, TrashIcon } from '@/shared/ui/icons'
import { controlClass } from '@/shared/ui/form/Input'
import IconButton from '@/shared/ui/buttons/IconButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import RowLabel from '@/shared/ui/RowLabel'
import Popover from '@/shared/ui/overlay/Popover'
import Tooltip from '@/shared/ui/overlay/Tooltip'

const rowBase = 'group flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-xs'
const rowIdle = 'text-ink-dim hover:bg-elevated hover:text-ink'

// Left-rail panel for the Schema rail icon: saved schema drafts. The
// schema-version migration history lives in its own workspace tab now
// (opened from the version badge in the header) — see SchemaHistoryView.
export default function SchemaPanel({
  drafts = [],
  onOpenDraft,
  onNewSchema,
  onRenameDraft,
  onDeleteDraft,
  onRefreshDrafts,
}: any) {
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)

  const sortedDrafts = useMemo(() => [...drafts].sort((a, b) => a.name.localeCompare(b.name)), [drafts])

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

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-4 pt-1">
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
    </>
  )
}
