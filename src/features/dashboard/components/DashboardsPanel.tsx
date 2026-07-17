import { useMemo, useState } from 'react'
import { EditIcon, GridIcon, MoreVerticalIcon, PlusIcon, RefreshIcon, SearchIcon, TrashIcon } from '@/shared/ui/icons'
import { Input } from '@/shared/ui/form/Input'
import IconButton from '@/shared/ui/buttons/IconButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import RowLabel from '@/shared/ui/RowLabel'
import ListRow from '@/shared/ui/ListRow'
import Popover from '@/shared/ui/overlay/Popover'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import type { DashboardSummary } from '../types'

// Left-rail list of this connection's dashboards. Modeled on WorkflowsPanel:
// open in a tab, create, rename inline, delete, import from JSON.
export default function DashboardsPanel({
  dashboards = [],
  activeId,
  onOpen,
  onNew,
  onImport,
  onRename,
  onDelete,
  onRefresh,
}: {
  dashboards: DashboardSummary[]
  activeId: string | null
  onOpen?: (d: DashboardSummary) => void
  onNew?: () => void
  onImport?: () => void
  onRename?: (id: string, name: string) => void
  onDelete?: (id: string) => void
  onRefresh?: () => void
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)

  const q = filter.trim().toLowerCase()
  const visible = useMemo(() => dashboards.filter((d) => !q || d.name.toLowerCase().includes(q)), [dashboards, q])

  const commitRename = () => {
    if (renaming?.value.trim()) onRename?.(renaming.id, renaming.value.trim())
    setRenaming(null)
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
        <span className="text-xs font-semibold">Dashboards</span>
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
          <Tooltip label="New dashboard" placement="bottom">
            <IconButton onClick={onNew}>
              <PlusIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {searchOpen && (
        <div className="px-3.5 pb-2">
          <Input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search dashboards…"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {visible.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-ink-faint">{q ? 'No matches' : 'No dashboards yet.'}</div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {visible.map((d) =>
              renaming?.id === d.id ? (
                <div key={d.id} className="flex items-center gap-2 px-2.5 py-1">
                  <GridIcon className="shrink-0 text-ink-faint" width={14} height={14} />
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
                <ListRow
                  key={d.id}
                  active={d.id === activeId}
                  onClick={() => onOpen?.(d)}
                  icon={<GridIcon className="shrink-0 text-ink-faint" width={14} height={14} />}
                  trailing={
                    <Popover
                      align="right"
                      width={170}
                      trigger={({ open, toggle }) => (
                        <IconButton
                          size="sm"
                          active={open}
                          onClick={toggle}
                          aria-label="Dashboard actions"
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
                          <MenuItem danger onClick={() => { onDelete?.(d.id); close() }}>
                            <TrashIcon width={14} height={14} /> Delete
                          </MenuItem>
                        </div>
                      )}
                    </Popover>
                  }
                >
                  <RowLabel>{d.name}</RowLabel>
                </ListRow>
              )
            )}
          </div>
        )}
        {onImport && (
          <button
            type="button"
            onClick={onImport}
            className="mt-2 w-full rounded-soft border border-dashed border-edge px-2.5 py-2 text-[11px] text-ink-faint transition-colors hover:border-edge-strong hover:text-ink"
          >
            Import from JSON…
          </button>
        )}
      </div>
    </>
  )
}
