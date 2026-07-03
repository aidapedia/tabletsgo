import { useMemo, useState } from 'react'
import { EditIcon, MoreVerticalIcon, PlusIcon, RefreshIcon, SearchIcon, TrashIcon, WorkflowIcon } from '@/shared/ui/icons'
import { controlClass } from '@/shared/ui/Input'
import IconButton from '@/shared/ui/IconButton'
import Popover from '@/shared/ui/Popover'
import Tooltip from '@/shared/ui/Tooltip'

const rowBase = 'group flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-xs'
const rowIdle = 'text-ink-dim hover:bg-elevated hover:text-ink'
const menuItem =
  'flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-[12px] text-ink-dim transition-colors hover:bg-card-hover hover:text-ink'
const kebabBtn = (open: boolean) =>
  `flex h-6 w-6 items-center justify-center rounded transition-colors ${
    open ? 'bg-card-hover text-ink opacity-100' : 'text-ink-faint opacity-0 hover:text-ink group-hover:opacity-100'
  }`

// Left-rail list of this connection's workflows. Modeled on SavedQueriesPanel
// (minus folders): open in a tab, create, rename inline, delete.
export default function WorkflowsPanel({ workflows = [], activeId, onOpen, onNew, onRename, onDelete, onRefresh }: any) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)

  const q = filter.trim().toLowerCase()
  const visible = useMemo(
    () => workflows.filter((w: any) => !q || w.name.toLowerCase().includes(q)),
    [workflows, q]
  )

  const commitRename = () => {
    if (renaming?.value.trim()) onRename?.(renaming.id, renaming.value.trim())
    setRenaming(null)
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
        <span className="text-xs font-semibold">Workflows</span>
        <div className="flex gap-1">
          <Tooltip label="Refresh" placement="bottom">
            <IconButton onClick={onRefresh}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Tooltip label="Search" placement="bottom">
            <IconButton
              active={searchOpen}
              onClick={() => {
                if (searchOpen) setFilter('')
                setSearchOpen((o) => !o)
              }}
            >
              <SearchIcon width={15} height={15} />
            </IconButton>
          </Tooltip>
          <Tooltip label="New workflow" placement="bottom">
            <IconButton onClick={onNew}>
              <PlusIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {searchOpen && (
        <div className="px-3.5 pb-2">
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search workflows…"
            className={controlClass}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {visible.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-ink-faint">{q ? 'No matches' : 'No workflows yet.'}</div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {visible.map((w: any) =>
              renaming?.id === w.id ? (
                <div key={w.id} className="flex items-center gap-2 px-2.5 py-1">
                  <WorkflowIcon className="shrink-0 text-ink-faint" width={14} height={14} />
                  <input
                    autoFocus
                    className={`${controlClass} !py-1`}
                    value={renaming.value}
                    onChange={(e) => setRenaming({ id: w.id, value: e.target.value })}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      else if (e.key === 'Escape') setRenaming(null)
                    }}
                  />
                </div>
              ) : (
                <div
                  key={w.id}
                  className={`${rowBase} cursor-pointer ${w.id === activeId ? 'bg-card-hover text-ink' : rowIdle}`}
                >
                  <WorkflowIcon className="shrink-0 text-ink-faint" width={14} height={14} />
                  <button onClick={() => onOpen?.(w)} className="min-w-0 flex-1 truncate text-left">
                    {w.name}
                  </button>
                  <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Popover
                      align="right"
                      width={170}
                      trigger={({ open, toggle }) => (
                        <button onClick={toggle} aria-label="Workflow actions" className={kebabBtn(open)}>
                          <MoreVerticalIcon width={15} height={15} />
                        </button>
                      )}
                    >
                      {({ close }) => (
                        <div className="p-1">
                          <button className={menuItem} onClick={() => { setRenaming({ id: w.id, value: w.name }); close() }}>
                            <EditIcon width={14} height={14} /> Rename
                          </button>
                          <div className="my-1 h-px bg-edge" />
                          <button className={`${menuItem} hover:!text-red`} onClick={() => { onDelete?.(w.id); close() }}>
                            <TrashIcon width={14} height={14} /> Delete
                          </button>
                        </div>
                      )}
                    </Popover>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </>
  )
}
