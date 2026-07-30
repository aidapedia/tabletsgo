import { useEffect, useMemo, useRef, useState } from 'react'
import IconButton from '@/shared/ui/buttons/IconButton'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import ListRow from '@/shared/ui/ListRow'
import RowLabel from '@/shared/ui/RowLabel'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import Popover from '@/shared/ui/overlay/Popover'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import SearchInput from '@/shared/ui/form/SearchInput'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import {
  ChevronRight,
  ClockIcon,
  CodeIcon,
  FolderIcon,
  FolderOpenIcon,
  KeyIcon,
  MoreVerticalIcon,
  RefreshIcon,
  TrashIcon,
} from '@/shared/ui/icons'
import { deleteKeys, getOverview, scanKeys, type RedisKeyMeta } from '../lib/api'
import { allBranchIds, buildKeyTree, formatTtl, TYPE_COLOR, TYPE_LABEL, type RedisTreeNode } from '../lib/tree'

// How many keys one "Load more" click pulls in. SCAN's COUNT is a hint, not a
// guarantee, so we keep asking until we've collected at least this many.
const PAGE_SIZE = 500
const MAX_SCAN_ROUNDS = 20

/**
 * The console's Redis sidebar: the connected database's keyspace as a tree,
 * built from the `:` namespacing convention (see `lib/tree`).
 *
 * Paged with SCAN — never KEYS — so pointing this at a production instance with
 * millions of keys is safe. The search box is a real Redis MATCH pattern pushed
 * down to the server, so filtering doesn't require having loaded the keyspace
 * first.
 */
export default function RedisKeyTree({
  conn,
  activeKey,
  onOpenKey,
  onRunCommand,
}: {
  conn: any
  activeKey?: string | null
  onOpenKey: (key: string) => void
  onRunCommand: (command: string) => void
}) {
  const toast = useToast()
  const [pattern, setPattern] = useState('')
  const [keys, setKeys] = useState<RedisKeyMeta[]>([])
  const [cursor, setCursor] = useState('0')
  const [done, setDone] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [overview, setOverview] = useState<{ keyCount: number; version: string | null } | null>(null)
  const [collapsed, setCollapsed] = useState(() => new Set<string>())
  const [deleting, setDeleting] = useState<{ keys: string[]; label: string } | null>(null)

  // Guards against a slow in-flight scan overwriting a newer one (fast typing
  // in the pattern box, or a database switch).
  const runId = useRef(0)

  const scanKey = `${conn.id}:${conn?.ns?.database || ''}`

  // Pull pages until we have PAGE_SIZE keys or the cursor wraps. One SCAN page
  // can legitimately come back empty, so a single round is never enough.
  const loadPage = async (startCursor: string, append: boolean) => {
    const mine = ++runId.current
    append ? setLoadingMore(true) : setLoading(true)
    const collected: RedisKeyMeta[] = []
    let next = startCursor
    let finished = false
    for (let round = 0; round < MAX_SCAN_ROUNDS; round++) {
      const page = await scanKeys(conn, { pattern: pattern.trim() || '*', cursor: next, count: PAGE_SIZE })
      if (runId.current !== mine) return // superseded
      collected.push(...page.keys)
      next = page.cursor
      finished = page.done
      if (finished || collected.length >= PAGE_SIZE) break
    }
    if (runId.current !== mine) return
    setKeys((prev) => (append ? dedupe([...prev, ...collected]) : collected))
    setCursor(next)
    setDone(finished)
    append ? setLoadingMore(false) : setLoading(false)
  }

  const reload = () => {
    setCollapsed(new Set())
    loadPage('0', false)
    getOverview(conn).then(setOverview)
  }

  // Reload on connection/database change, and debounce pattern typing.
  useEffect(() => {
    const t = setTimeout(reload, pattern ? 300 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanKey, pattern])

  const tree = useMemo(() => buildKeyTree(keys), [keys])

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const collapseAll = () => setCollapsed(new Set(allBranchIds(tree)))
  const expandAll = () => setCollapsed(new Set())

  const confirmDelete = async () => {
    if (!deleting) return
    const target = deleting.keys
    setDeleting(null)
    try {
      const { deleted } = await deleteKeys(conn, target)
      setKeys((prev) => prev.filter((k) => !target.includes(k.key)))
      setOverview((o) => (o ? { ...o, keyCount: Math.max(o.keyCount - deleted, 0) } : o))
      toast.success(`Deleted ${deleted} key${deleted === 1 ? '' : 's'}.`)
    } catch (e) {
      toast.error(`Delete failed: ${e.message}`)
    }
  }

  // Every key beneath a branch — what "Delete all keys" acts on.
  const keysUnder = (node: RedisTreeNode): string[] =>
    node.kind === 'key' ? [node.meta.key] : node.children.flatMap(keysUnder)

  const renderNode = (node: RedisTreeNode, depth: number) => {
    const indent = { paddingLeft: `${8 + depth * 12}px` }

    if (node.kind === 'branch') {
      const open = !collapsed.has(node.id)
      return (
        <div key={node.id}>
          <ListRow
            style={indent}
            onClick={() => toggle(node.id)}
            icon={
              <>
                <ChevronRight
                  width={12}
                  height={12}
                  className={`shrink-0 text-ink-faint transition-transform ${open ? 'rotate-90' : ''}`}
                />
                {open ? (
                  <FolderOpenIcon width={14} height={14} className="shrink-0 text-ink-faint" />
                ) : (
                  <FolderIcon width={14} height={14} className="shrink-0 text-ink-faint" />
                )}
              </>
            }
            trailing={
              <Popover
                align="right"
                width={220}
                placement="top"
                portal
                trigger={({ open: menuOpen, toggle: toggleMenu }) => (
                  <IconButton
                    size="sm"
                    active={menuOpen}
                    onClick={toggleMenu}
                    aria-label={`${node.prefix} actions`}
                    className={menuOpen ? 'opacity-100' : '!text-ink-faint opacity-0 group-hover:opacity-100'}
                  >
                    <MoreVerticalIcon width={15} height={15} />
                  </IconButton>
                )}
              >
                {({ close }) => (
                  <div className="p-1">
                    <MenuItem onClick={() => { setPattern(`${node.prefix}:*`); close() }}>
                      <KeyIcon width={14} height={14} /> Filter to this namespace
                    </MenuItem>
                    <MenuItem onClick={() => { onRunCommand(`SCAN 0 MATCH ${node.prefix}:* COUNT 100`); close() }}>
                      <CodeIcon width={14} height={14} /> Scan in console
                    </MenuItem>
                    <div className="my-1 h-px bg-edge" />
                    <MenuItem
                      danger
                      onClick={() => {
                        const target = keysUnder(node)
                        setDeleting({ keys: target, label: `${target.length} key(s) under "${node.prefix}"` })
                        close()
                      }}
                    >
                      <TrashIcon width={14} height={14} /> Delete loaded keys
                    </MenuItem>
                  </div>
                )}
              </Popover>
            }
          >
            <RowLabel title={node.prefix} className="font-medium">
              {node.label}
            </RowLabel>
            <span className="shrink-0 text-[10px] text-ink-faint">{node.keyCount}</span>
          </ListRow>
          {open && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }

    const { meta } = node
    return (
      <ListRow
        key={node.id}
        style={indent}
        active={activeKey === meta.key}
        onClick={() => onOpenKey(meta.key)}
        icon={<KeyIcon width={14} height={14} className="shrink-0 text-ink-faint" />}
        trailing={
          <Popover
            align="right"
            width={220}
            placement="top"
            portal
            trigger={({ open, toggle: toggleMenu }) => (
              <IconButton
                size="sm"
                active={open}
                onClick={toggleMenu}
                aria-label={`${meta.key} actions`}
                className={open ? 'opacity-100' : '!text-ink-faint opacity-0 group-hover:opacity-100'}
              >
                <MoreVerticalIcon width={15} height={15} />
              </IconButton>
            )}
          >
            {({ close }) => (
              <div className="p-1">
                <MenuItem onClick={() => { onOpenKey(meta.key); close() }}>
                  <KeyIcon width={14} height={14} /> Open key
                </MenuItem>
                <MenuItem onClick={() => { onRunCommand(readCommandFor(meta)); close() }}>
                  <CodeIcon width={14} height={14} /> Open in console
                </MenuItem>
                <MenuItem onClick={() => { navigator.clipboard?.writeText(meta.key); toast.success('Key copied.'); close() }}>
                  <KeyIcon width={14} height={14} /> Copy key name
                </MenuItem>
                <MenuItem onClick={() => { onRunCommand(`TTL ${meta.key}`); close() }}>
                  <ClockIcon width={14} height={14} /> Check TTL
                </MenuItem>
                <div className="my-1 h-px bg-edge" />
                <MenuItem danger onClick={() => { setDeleting({ keys: [meta.key], label: `"${meta.key}"` }); close() }}>
                  <TrashIcon width={14} height={14} /> Delete key
                </MenuItem>
              </div>
            )}
          </Popover>
        }
      >
        <RowLabel title={meta.key}>{node.label}</RowLabel>
        {meta.ttlMs != null && (
          <span className="shrink-0 text-[10px] text-ink-faint group-hover:hidden" title={`Expires in ${formatTtl(meta.ttlMs)}`}>
            {formatTtl(meta.ttlMs)}
          </span>
        )}
        <span
          className={`shrink-0 rounded-[5px] border px-1 py-px text-[9px] font-semibold uppercase ${
            TYPE_COLOR[meta.type] || 'border-edge bg-elevated text-ink-faint'
          }`}
        >
          {TYPE_LABEL[meta.type] || meta.type}
        </span>
      </ListRow>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 pb-2.5 pt-4 text-[11px] font-semibold">
        <span className="text-xs">Keys</span>
        <div className="flex gap-1">
          <Tooltip label="Expand all" placement="bottom">
            <IconButton onClick={expandAll} aria-label="Expand all namespaces">
              <FolderOpenIcon width={15} height={15} />
            </IconButton>
          </Tooltip>
          <Tooltip label="Collapse all" placement="bottom">
            <IconButton onClick={collapseAll} aria-label="Collapse all namespaces">
              <FolderIcon width={15} height={15} />
            </IconButton>
          </Tooltip>
          <Tooltip label="Refresh" placement="bottom">
            <IconButton onClick={reload} aria-label="Refresh keys">
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      <SearchInput
        className="mx-3.5 mb-2"
        placeholder="Match pattern, e.g. user:*"
        value={pattern}
        onChange={(e) => setPattern(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setPattern('')}
        inputClassName="!rounded-[9px] !text-xs !font-mono"
      />

      <div className="flex items-center justify-between px-4 pb-2 text-[10px] text-ink-faint">
        <span>
          {keys.length} loaded
          {overview ? ` · ${overview.keyCount} in ${conn?.ns?.database || 'db0'}` : ''}
        </span>
        {overview?.version && <span>Redis {overview.version}</span>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {loading && <div className="p-6 text-center text-xs text-ink-faint">Scanning keyspace…</div>}
        {!loading && !keys.length && (
          <div className="p-6 text-center text-xs text-ink-faint">
            {pattern.trim() ? `No keys match "${pattern.trim()}".` : 'This database has no keys.'}
          </div>
        )}
        {!loading && tree.map((node) => renderNode(node, 0))}
        {!loading && !done && (
          <div className="px-2 pt-2">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => loadPage(cursor, true)} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more keys'}
            </Button>
          </div>
        )}
        {!loading && done && keys.length > 0 && (
          <div className="px-2 pb-1 pt-2 text-center text-[10px] text-ink-faint">
            End of keyspace ·{' '}
            <TextButton tone="faint" className="!text-[10px]" onClick={reload}>
              rescan
            </TextButton>
          </div>
        )}
      </div>

      {deleting && (
        <ConfirmDialog
          title="Delete keys?"
          message={`This permanently removes ${deleting.label} from Redis. This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
      )}
    </>
  )
}

const dedupe = (list: RedisKeyMeta[]) => {
  const seen = new Set<string>()
  return list.filter((k) => (seen.has(k.key) ? false : (seen.add(k.key), true)))
}

// The command that reads a key of this type, for "Open in console".
function readCommandFor(meta: RedisKeyMeta) {
  switch (meta.type) {
    case 'list': return `LRANGE ${meta.key} 0 -1`
    case 'set': return `SMEMBERS ${meta.key}`
    case 'zset': return `ZRANGE ${meta.key} 0 -1 WITHSCORES`
    case 'hash': return `HGETALL ${meta.key}`
    case 'stream': return `XRANGE ${meta.key} - + COUNT 100`
    default: return `GET ${meta.key}`
  }
}
