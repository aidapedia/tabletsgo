import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, CloseIcon, DbLogo, FolderIcon, SearchIcon } from '@/shared/ui/icons'
import EnvBadge from './EnvBadge'
import { TYPE_LABEL } from './DbTypePickerModal'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'

type Conn = {
  id: string
  name: string
  type?: string
  environment?: string
  folder?: string
  host?: string
  filepath?: string
  database?: string
}

type FolderNode = {
  name: string
  path: string
  folders: FolderNode[]
  connections: Conn[]
}

type Row =
  | { kind: 'folder'; key: string; depth: number; node: FolderNode; count: number }
  | { kind: 'conn'; key: string; depth: number; conn: Conn }

const emptyNode = (name: string, path: string): FolderNode => ({ name, path, folders: [], connections: [] })

// A connection's `folder` is a plain string; treat "/" as nesting so folders
// like "Ops/Prod" render as a tree. A blank folder lands at the root.
function buildTree(connections: Conn[]): FolderNode {
  const root = emptyNode('', '')
  for (const conn of connections) {
    const segments = (conn.folder || '').split('/').map((s) => s.trim()).filter(Boolean)
    let node = root
    for (const segment of segments) {
      let next = node.folders.find((f) => f.name === segment)
      if (!next) {
        next = emptyNode(segment, node.path ? `${node.path}/${segment}` : segment)
        node.folders.push(next)
      }
      node = next
    }
    node.connections.push(conn)
  }
  sortNode(root)
  return root
}

function sortNode(node: FolderNode) {
  node.folders.sort((a, b) => a.name.localeCompare(b.name))
  node.connections.sort((a, b) => a.name.localeCompare(b.name))
  node.folders.forEach(sortNode)
}

const countNode = (node: FolderNode): number =>
  node.connections.length + node.folders.reduce((n, f) => n + countNode(f), 0)

// Depth-first flatten of the visible rows — the list the keyboard walks.
function flatten(node: FolderNode, isOpen: (path: string) => boolean, depth = 0): Row[] {
  const rows: Row[] = []
  for (const folder of node.folders) {
    rows.push({ kind: 'folder', key: `f:${folder.path}`, depth, node: folder, count: countNode(folder) })
    if (isOpen(folder.path)) rows.push(...flatten(folder, isOpen, depth + 1))
  }
  for (const conn of node.connections) rows.push({ kind: 'conn', key: `c:${conn.id}`, depth, conn })
  return rows
}

const subtitleOf = (c: Conn) => (c.type === 'sqlite' ? c.filepath : c.host) || c.database || ''

// "Switch connection" overlay: search, filter by database type, and pick from
// the folder tree. Purely presentational — the caller decides what selecting a
// connection means (the console confirms first, since switching wipes tabs).
export default function ConnectionSwitcherModal({
  connections = [],
  currentId,
  onSelect,
  onClose,
}: {
  connections?: Conn[]
  currentId?: string
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [type, setType] = useState('all')
  const [collapsed, setCollapsed] = useState<string[]>([]) // folders start expanded
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Database types actually in use, with counts — the filter chips.
  const types = useMemo(() => {
    const counts = new Map<string, number>()
    connections.forEach((c) => c.type && counts.set(c.type, (counts.get(c.type) || 0) + 1))
    return [...counts.entries()].map(([id, count]) => ({ id, count }))
  }, [connections])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return connections.filter((c) => {
      if (type !== 'all' && c.type !== type) return false
      if (!q) return true
      const haystack = [c.name, c.folder, c.environment, c.host, c.filepath, c.database, TYPE_LABEL[c.type || ''] || c.type]
      return haystack.some((v) => v?.toLowerCase().includes(q))
    })
  }, [connections, query, type])

  const tree = useMemo(() => buildTree(matches), [matches])

  // While searching every folder is forced open, so matches are never hidden.
  const searching = !!query.trim()
  const isOpen = (path: string) => searching || !collapsed.includes(path)
  const rows = useMemo(() => flatten(tree, isOpen), [tree, collapsed, searching])

  const toggleFolder = (path: string) =>
    setCollapsed((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]))

  // Clamp the highlight when the result set shrinks, and keep it in view.
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, rows.length - 1)))
  }, [rows.length])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const activateRow = (i: number) => {
    const row = rows[i]
    if (!row) return
    if (row.kind === 'folder') toggleFolder(row.node.path)
    else onSelect(row.conn.id)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (rows.length ? (i + 1) % rows.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      activateRow(active)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} className="flex max-h-[70vh] sm:max-w-[560px] flex-col p-0 top-[10vh] translate-y-0 gap-0">
        <DialogTitle className="sr-only">Switch connection</DialogTitle>
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <SearchIcon width={16} height={16} className="shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Search connections, folders, hosts…"
            className="w-full bg-transparent py-3.5 text-[13px] text-foreground outline-none placeholder:text-faint"
          />
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </Button>
        </div>

        {/* Database type filter */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
          <FilterChip label={`All (${connections.length})`} active={type === 'all'} onClick={() => setType('all')} />
          {types.map((t) => (
            <FilterChip
              key={t.id}
              label={`${TYPE_LABEL[t.id] || t.id} (${t.count})`}
              icon={<DbLogo type={t.id} className="h-3.5 w-3.5" />}
              active={type === t.id}
              onClick={() => setType(t.id)}
            />
          ))}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {rows.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-faint">No matching connections</div>
          ) : (
            rows.map((row, i) => {
              const isActive = i === active
              const indent = { paddingLeft: 10 + row.depth * 14 }
              if (row.kind === 'folder') {
                return (
                  <button
                    key={row.key}
                    type="button"
                    data-active={isActive}
                    style={indent}
                    onMouseMove={() => setActive(i)}
                    onClick={() => toggleFolder(row.node.path)}
                    className={`flex w-full items-center gap-2 rounded-[8px] py-1.5 pr-2.5 text-left text-[12px] font-semibold transition-colors ${
                      isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60'
                    }`}
                  >
                    {isOpen(row.node.path) ? (
                      <ChevronDown width={13} height={13} className="shrink-0 text-faint" />
                    ) : (
                      <ChevronRight width={13} height={13} className="shrink-0 text-faint" />
                    )}
                    <FolderIcon width={14} height={14} className="shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate">{row.node.name}</span>
                    <span className="shrink-0 text-[11px] font-normal text-faint">{row.count}</span>
                  </button>
                )
              }
              const conn = row.conn
              const subtitle = subtitleOf(conn)
              return (
                <button
                  key={row.key}
                  type="button"
                  data-active={isActive}
                  style={indent}
                  onMouseMove={() => setActive(i)}
                  onClick={() => onSelect(conn.id)}
                  className={`flex w-full items-center gap-2.5 rounded-[8px] py-1.5 pr-2.5 text-left transition-colors ${
                    isActive ? 'bg-muted' : 'hover:bg-muted/60'
                  }`}
                >
                  <DbLogo type={conn.type} className="h-7 w-7 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] text-foreground">{conn.name}</span>
                      {conn.id === currentId && (
                        <span className="shrink-0 rounded-[5px] border border-border bg-card px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-faint">
                          Current
                        </span>
                      )}
                    </span>
                    {subtitle && <span className="block truncate text-[11px] text-faint">{subtitle}</span>}
                  </span>
                  <EnvBadge environment={conn.environment} dense className="shrink-0" />
                </button>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FilterChip({
  label,
  icon,
  active,
  onClick,
}: {
  label: string
  icon?: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active ? 'border-input bg-muted text-foreground' : 'border-border text-muted-foreground hover:bg-muted/60'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
