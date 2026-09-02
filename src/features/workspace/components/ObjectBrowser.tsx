import { useEffect, useMemo, useRef, useState } from 'react'
import Segmented from '@/shared/ui/form/Segmented'
import SearchInput from '@/shared/ui/form/SearchInput'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import Popover from '@/shared/ui/overlay/Popover'
import IconButton from '@/shared/ui/buttons/IconButton'
import TextButton from '@/shared/ui/buttons/TextButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import ListRow from '@/shared/ui/ListRow'
import RowLabel from '@/shared/ui/RowLabel'
import {
  ChevronRight,
  CodeIcon,
  ColumnsIcon,
  EditIcon,
  EyeIcon,
  FolderPlusIcon,
  MoreVerticalIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  TableIcon,
  TrashIcon,
} from '@/shared/ui/icons'
import { TableFolderList, FolderDot, fetchTableFolders, deleteTableFolder } from '@/features/table-folders'
import type { ConsoleTab } from '../hooks/useConsoleTabs'

const centerState = 'flex h-full flex-col items-center justify-center gap-4 text-ink-faint'

type Props = {
  connectionId: string
  objects: any[]
  loading: boolean
  /** The tabs currently on screen — a browser row lights up for its own tab. */
  onScreen: ConsoleTab[]
  toast: any
  onRefresh: () => void
  onOpenTable: (name: string) => void
  onOpenSchema: (name: string) => void
  onOpenFunction: (name: string) => void
  onOpenQuery: (sql?: string) => void
  onEditTable: (name: string) => void
  onTableAction: (action: { table: string; mode: 'empty' | 'delete' }) => void
  onCreateTable: () => void
}

/**
 * The relational sidebar: tables (bucketed into folders), views and functions.
 *
 * Everything this needs to draw — the filter, the sort, which accordion section
 * is open, the table folders themselves — is only ever read here, so it is all
 * owned here rather than threaded down from the console.
 */
export default function ObjectBrowser({
  connectionId,
  objects,
  loading,
  onScreen,
  toast,
  onRefresh,
  onOpenTable,
  onOpenSchema,
  onOpenFunction,
  onOpenQuery,
  onEditTable,
  onTableAction,
  onCreateTable,
}: Props) {
  const [filter, setFilter] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [openGroup, setOpenGroup] = useState<string | null>('table') // the one expanded section
  const [tableSort, setTableSort] = useState('az') // 'az' | 'za'
  const [tableFolders, setTableFolders] = useState<any[]>([])
  const [creatingFolder, setCreatingFolder] = useState<any>(null) // { parentId } while naming | null
  const searchRef = useRef(null)

  useEffect(() => {
    let alive = true
    fetchTableFolders(connectionId).then((list: any) => alive && setTableFolders(list))
    return () => {
      alive = false
    }
  }, [connectionId])

  // Accordion: opening a section collapses the others; clicking the open one closes it.
  const toggleGroup = (type: string) => setOpenGroup((prev) => (prev === type ? null : type))

  const visibleObjects = objects
    .filter((o) => o.name.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => (tableSort === 'az' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)))

  const objectGroups = [
    { type: 'table', label: 'Tables', items: visibleObjects.filter((o) => o.type === 'table') },
    { type: 'view', label: 'Views', items: visibleObjects.filter((o) => o.type === 'view') },
    { type: 'function', label: 'Functions', items: visibleObjects.filter((o) => o.type === 'function') },
    // Tables also stays visible while it only holds folders (empty ones, or all
    // of their tables filtered out) — otherwise the folder tree would vanish.
  ].filter((g) => g.items.length > 0 || (g.type === 'table' && (tableFolders.length > 0 || creatingFolder)))

  // tableName -> its folder (drives the inline dot + the grouped view).
  const folderByTable = useMemo(() => {
    const map: Record<string, any> = {}
    for (const d of tableFolders) for (const tn of d.tables || []) map[tn] = d
    return map
  }, [tableFolders])

  const removeTableFolder = async (folderId: string) => {
    // Mirror the server locally: subfolders and member tables move up one level
    // (to this folder's parent — the root, i.e. ungrouped, for a top-level one).
    const prev = tableFolders
    const gone = tableFolders.find((f) => f.id === folderId)
    const parentId = gone?.parentId || null
    setTableFolders((list) =>
      list
        .filter((f) => f.id !== folderId)
        .map((f) => ({
          ...f,
          parentId: (f.parentId || null) === folderId ? parentId : f.parentId,
          tables: f.id === parentId ? [...f.tables, ...(gone?.tables || [])] : f.tables,
        }))
    )
    try {
      await deleteTableFolder(connectionId, folderId)
    } catch (e: any) {
      setTableFolders(prev)
      toast.error(`Delete failed: ${e.message}`)
    }
  }

  // One table/view/function row (used flat and inside table folders).
  // `rowProps` is spread onto the row so the folder view can make it draggable.
  const renderObject = (obj: any, rowProps: any = {}) => {
    const active = onScreen.some((t) =>
      obj.type === 'function' ? t.kind === 'function' && t.name === obj.name : t.kind === 'table' && t.table === obj.name
    )
    const Icon = obj.type === 'view' ? EyeIcon : obj.type === 'function' ? CodeIcon : TableIcon
    const onOpen = obj.type === 'function' ? () => onOpenFunction(obj.name) : () => onOpenTable(obj.name)
    const rowFolder = obj.type === 'table' ? folderByTable[obj.name] : null
    return (
      <ListRow
        key={`${obj.type}:${obj.name}`}
        active={active}
        onClick={onOpen}
        icon={<Icon className={`flex-shrink-0 ${active ? 'text-ink' : 'text-ink-faint'}`} />}
        {...rowProps}
      >
        <RowLabel title={obj.type === 'function' && obj.detail ? `${obj.name}(${obj.detail})` : obj.name}>
          {obj.name}
        </RowLabel>
        {rowFolder && (
          <span className="shrink-0 group-hover:hidden" title={rowFolder.name}>
            <FolderDot color={rowFolder.color} size={7} />
          </span>
        )}
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <Popover
            align="right"
            width={210}
            placement="top"
            portal
            trigger={({ open, toggle }: any) => (
              <IconButton
                size="sm"
                active={open}
                onClick={toggle}
                aria-label={`${obj.type} actions`}
                className={open ? 'opacity-100' : '!text-ink-faint opacity-0 group-hover:opacity-100'}
              >
                <MoreVerticalIcon width={15} height={15} />
              </IconButton>
            )}
          >
            {({ close }: any) => (
              <div className="p-1">
                {obj.type === 'function' ? (
                  <>
                    <MenuItem onClick={() => { onOpenFunction(obj.name); close() }}>
                      <CodeIcon width={14} height={14} /> Open definition
                    </MenuItem>
                    <MenuItem onClick={() => { onOpenQuery(`SELECT ${obj.name}();`); close() }}>
                      <CodeIcon width={14} height={14} /> Open in SQL Editor
                    </MenuItem>
                  </>
                ) : (
                  <>
                    <MenuItem onClick={() => { onOpenTable(obj.name); close() }}>
                      <TableIcon width={14} height={14} /> Open in new tab
                    </MenuItem>
                    <MenuItem onClick={() => { onOpenQuery(`SELECT * FROM "${obj.name}";`); close() }}>
                      <CodeIcon width={14} height={14} /> Open in SQL Editor
                    </MenuItem>
                    <MenuItem onClick={() => { onOpenSchema(obj.name); close() }}>
                      <ColumnsIcon width={14} height={14} />
                      {obj.type === 'view' ? 'View schema' : 'View table schema'}
                    </MenuItem>
                    {/* A view has no rows of its own to edit, empty or drop. */}
                    {obj.type === 'table' && (
                      <>
                        <MenuItem onClick={() => { onEditTable(obj.name); close() }}>
                          <EditIcon width={14} height={14} /> Edit Table
                        </MenuItem>
                        <div className="my-1 h-px bg-edge" />
                        <MenuItem danger onClick={() => { onTableAction({ table: obj.name, mode: 'empty' }); close() }}>
                          <TrashIcon width={14} height={14} /> Empty Table
                        </MenuItem>
                        <MenuItem danger onClick={() => { onTableAction({ table: obj.name, mode: 'delete' }); close() }}>
                          <TrashIcon width={14} height={14} /> Delete Table
                        </MenuItem>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </Popover>
        </div>
      </ListRow>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 pb-2.5 pt-4 text-[11px] font-semibold">
        <span className="text-xs">Tables</span>
        <div className="flex gap-1">
          <Tooltip label="Refresh" placement="bottom">
            <IconButton onClick={onRefresh}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Tooltip label="Search tables" placement="bottom">
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
          <Tooltip label="New folder" placement="bottom">
            <IconButton
              onClick={() => {
                setOpenGroup('table')
                setCreatingFolder({ parentId: null })
              }}
              aria-label="New table folder"
            >
              <FolderPlusIcon />
            </IconButton>
          </Tooltip>
          <Tooltip label="Create table" placement="bottom">
            <IconButton onClick={onCreateTable}>
              <PlusIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      <div className="px-3.5 pb-2">
        <Segmented
          value={tableSort}
          onChange={setTableSort}
          options={[
            { value: 'az', label: 'A–Z' },
            { value: 'za', label: 'Z–A' },
          ]}
        />
      </div>

      {searchOpen && (
        <SearchInput
          ref={searchRef}
          autoFocus
          className="mx-3.5 mb-2.5"
          placeholder="Search tables…"
          value={filter}
          onChange={(e: any) => setFilter(e.target.value)}
          onKeyDown={(e: any) => {
            if (e.key === 'Escape') {
              setFilter('')
              setSearchOpen(false)
            }
          }}
          inputClassName="!rounded-[9px] !text-xs"
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden px-2 pb-2 pt-1">
        {loading && <div className={`${centerState} text-xs`}>Loading…</div>}
        {!loading &&
          objectGroups.map((group) => (
            <div key={group.type} className={`flex min-h-0 flex-col ${openGroup === group.type ? 'flex-1' : 'shrink-0'}`}>
              {/* Accordion section header — always visible so you can jump to
                  Tables / Views / Functions; only the open section's list scrolls. */}
              <TextButton
                tone="faint"
                className="w-full shrink-0 rounded-[6px] px-1.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide hover:!text-ink-dim"
                onClick={() => toggleGroup(group.type)}
              >
                <ChevronRight
                  width={12}
                  height={12}
                  className={`transition-transform ${openGroup === group.type ? 'rotate-90' : ''}`}
                />
                {group.label} <span className="opacity-60">{group.items.length}</span>
              </TextButton>
              {openGroup === group.type && (
                <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-0.5">
                  {group.type === 'table' ? (
                    <TableFolderList
                      connectionId={connectionId}
                      folders={tableFolders}
                      tables={group.items}
                      searching={!!filter.trim()}
                      creating={creatingFolder}
                      onCreatingChange={setCreatingFolder}
                      onChange={setTableFolders}
                      onDelete={removeTableFolder}
                      renderTable={renderObject}
                    />
                  ) : (
                    group.items.map((o) => renderObject(o))
                  )}
                </div>
              )}
            </div>
          ))}
        {!loading && objectGroups.length === 0 && <div className={`${centerState} text-xs`}>No objects</div>}
      </div>
    </>
  )
}
