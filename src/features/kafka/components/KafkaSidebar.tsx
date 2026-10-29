import { useEffect, useMemo, useState } from 'react'
import IconButton from '@/shared/ui/buttons/IconButton'
import ListRow from '@/shared/ui/ListRow'
import RowLabel from '@/shared/ui/RowLabel'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import Popover from '@/shared/ui/overlay/Popover'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import SearchInput from '@/shared/ui/form/SearchInput'
import Segmented from '@/shared/ui/form/Segmented'
import Checkbox from '@/shared/ui/form/Checkbox'
import {
  ChevronRight,
  CodeIcon,
  FolderIcon,
  FolderOpenIcon,
  MoreVerticalIcon,
  PlusIcon,
  RefreshIcon,
  SendIcon,
  TopicIcon,
} from '@/shared/ui/icons'
import { getOverview, listGroups, listTopics, type GroupSummary, type StreamOverview, type TopicSummary } from '../lib/api'
import { buildTopicTree, compact, groupStateLook, lagTone } from '../lib/format'
import CreateTopicDialog from './CreateTopicDialog'

/**
 * The console's sidebar for a stream engine: the cluster's topics (grouped by
 * their dotted prefix) or its consumer groups, behind one switch. Opening either
 * opens a tab; the console owns the tabs.
 */
export default function KafkaSidebar({
  conn,
  activeTopic,
  activeGroup,
  onOpenTopic,
  onOpenGroup,
  onProduce,
  onRunCommand,
}: {
  conn: any
  activeTopic?: string | null
  activeGroup?: string | null
  onOpenTopic: (topic: string) => void
  onOpenGroup: (group: string) => void
  onProduce: (topic: string) => void
  onRunCommand: (command: string) => void
}) {
  const [view, setView] = useState<'topics' | 'groups'>('topics')
  const [filter, setFilter] = useState('')
  const [internal, setInternal] = useState(false)
  const [overview, setOverview] = useState<StreamOverview | null>(null)
  const [topics, setTopics] = useState<TopicSummary[] | null>(null)
  const [groups, setGroups] = useState<GroupSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(() => new Set<string>())
  const [creating, setCreating] = useState(false)

  const loadTopics = () =>
    listTopics(conn, { internal })
      .then((list) => {
        setTopics(list)
        setError(null)
      })
      .catch((e) => setError(e.message))
  const loadGroups = () =>
    listGroups(conn)
      .then((list) => {
        setGroups(list)
        setError(null)
      })
      .catch((e) => setError(e.message))
  const reload = () => {
    getOverview(conn).then(setOverview).catch(() => {})
    if (view === 'topics') loadTopics()
    else loadGroups()
  }

  useEffect(() => {
    getOverview(conn).then(setOverview).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.id])
  useEffect(() => {
    loadTopics()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.id, internal])
  useEffect(() => {
    if (view === 'groups' && groups === null) loadGroups()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const needle = filter.trim().toLowerCase()
  const shownTopics = useMemo(() => (topics || []).filter((t) => !needle || t.name.toLowerCase().includes(needle)), [topics, needle])
  const tree = useMemo(() => buildTopicTree(shownTopics), [shownTopics])
  const shownGroups = useMemo(
    () => (groups || []).filter((g) => !needle || g.id.toLowerCase().includes(needle)).sort((a, b) => b.lag - a.lag || a.id.localeCompare(b.id)),
    [groups, needle]
  )

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const topicRow = (t: TopicSummary, depth: number) => (
    <ListRow
      key={t.name}
      style={{ paddingLeft: `${10 + depth * 18}px` }}
      active={activeTopic === t.name}
      onClick={() => onOpenTopic(t.name)}
      title={t.name}
      icon={<TopicIcon width={14} height={14} className={`shrink-0 ${activeTopic === t.name ? 'text-green' : 'text-ink-faint'}`} />}
      trailing={
        <Popover
          align="right"
          width={210}
          portal
          trigger={({ open, toggle: toggleMenu }) => (
            <IconButton
              size="sm"
              active={open}
              onClick={toggleMenu}
              aria-label={`${t.name} actions`}
              className={open ? 'opacity-100' : '!text-ink-faint opacity-0 group-hover:opacity-100'}
            >
              <MoreVerticalIcon width={15} height={15} />
            </IconButton>
          )}
        >
          {({ close }) => (
            <div className="p-1">
              <MenuItem onClick={() => { onProduce(t.name); close() }}>
                <SendIcon width={14} height={14} /> Produce message
              </MenuItem>
              <MenuItem onClick={() => { onRunCommand(`CONSUME ${t.name} FROM -20 LIMIT 20`); close() }}>
                <CodeIcon width={14} height={14} /> Consume in console
              </MenuItem>
            </div>
          )}
        </Popover>
      }
    >
      <RowLabel className={activeTopic === t.name ? 'font-medium' : ''}>{depth ? t.name.slice(t.name.indexOf('.') + 1) : t.name}</RowLabel>
      {t.underReplicated > 0 && (
        <Tooltip label={`${t.underReplicated} under-replicated partition(s)`} placement="right">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
        </Tooltip>
      )}
      <span className="shrink-0 font-mono text-[10px] text-ink-faint">{t.partitions}</span>
    </ListRow>
  )

  return (
    <>
      <div className="flex items-center justify-between px-4 pb-1 pt-4">
        <span className="text-xs font-semibold">{view === 'topics' ? 'Topics' : 'Consumer groups'}</span>
        <div className="flex gap-1">
          {view === 'topics' && (
            <Tooltip label="New topic" placement="bottom">
              <IconButton onClick={() => setCreating(true)} aria-label="New topic">
                <PlusIcon width={15} height={15} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip label="Refresh" placement="bottom">
            <IconButton onClick={reload} aria-label={view === 'topics' ? 'Refresh topics' : 'Refresh groups'}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-4 pb-2.5 text-[10px] text-ink-faint">
        <span className={`h-1.5 w-1.5 rounded-full ${overview ? 'bg-status-ok' : 'bg-ink-faint'}`} />
        {overview
          ? `${overview.brokers.length} broker${overview.brokers.length === 1 ? '' : 's'} · ${overview.topicCount} topics`
          : 'Connecting…'}
      </div>

      <div className="px-3.5 pb-2">
        <Segmented
          className="w-full [&>button]:flex-1"
          value={view}
          onChange={setView}
          options={[
            { value: 'topics', label: 'Topics' },
            { value: 'groups', label: `Groups${groups ? ` ${groups.length}` : ''}` },
          ]}
        />
      </div>

      <SearchInput
        className="mx-3.5 mb-2"
        placeholder={view === 'topics' ? 'Filter topics' : 'Filter groups'}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
        inputClassName="!rounded-[9px] !text-xs"
      />

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {error && <div className="m-2 rounded-[9px] border border-red/25 bg-red/10 px-3 py-2.5 text-[11px] text-[#ff9b9b]">{error}</div>}

        {view === 'topics' && !error && (
          <>
            {topics === null && <div className="p-6 text-center text-xs text-ink-faint">Loading topics…</div>}
            {topics !== null && !shownTopics.length && (
              <div className="p-6 text-center text-xs text-ink-faint">{needle ? `No topics match "${filter.trim()}".` : 'This cluster has no topics yet.'}</div>
            )}
            {tree.map((node) => {
              if (node.kind === 'topic') return topicRow(node.topic, 0)
              const open = !collapsed.has(node.id) || Boolean(needle)
              return (
                <div key={`folder:${node.id}`}>
                  <ListRow
                    onClick={() => toggle(node.id)}
                    icon={
                      <>
                        <ChevronRight width={12} height={12} className={`shrink-0 text-ink-faint transition-transform ${open ? 'rotate-90' : ''}`} />
                        {open ? (
                          <FolderOpenIcon width={14} height={14} className="shrink-0 text-ink-faint" />
                        ) : (
                          <FolderIcon width={14} height={14} className="shrink-0 text-ink-faint" />
                        )}
                      </>
                    }
                  >
                    <RowLabel className="font-medium">{node.label}</RowLabel>
                    <span className="shrink-0 text-[10px] text-ink-faint">{node.children.length}</span>
                  </ListRow>
                  {open && node.children.map((t) => topicRow(t, 1))}
                </div>
              )
            })}
          </>
        )}

        {view === 'groups' && !error && (
          <>
            {groups === null && <div className="p-6 text-center text-xs text-ink-faint">Loading consumer groups…</div>}
            {groups !== null && !shownGroups.length && (
              <div className="p-6 text-center text-xs text-ink-faint">{needle ? `No groups match "${filter.trim()}".` : 'No consumer groups on this cluster.'}</div>
            )}
            {shownGroups.map((g) => {
              const look = groupStateLook(g.state)
              return (
                <ListRow
                  key={g.id}
                  active={activeGroup === g.id}
                  onClick={() => onOpenGroup(g.id)}
                  title={g.id}
                  icon={<span className={`h-2 w-2 shrink-0 rounded-full ${look.dot}`} />}
                  className="!py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${activeGroup === g.id ? 'font-medium' : ''}`}>{g.id}</span>
                    <span className="block text-[10px] text-ink-faint">
                      {look.label} · {g.members} member{g.members === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className={`shrink-0 font-mono text-[10px] ${lagTone(g.lag)}`}>{compact(g.lag)}</span>
                </ListRow>
              )
            })}
          </>
        )}
      </div>

      {view === 'topics' && (
        <div className="flex items-center justify-between border-t border-edge px-4 py-2 text-[10px] text-ink-faint">
          <span>{topics ? `${shownTopics.length} topic${shownTopics.length === 1 ? '' : 's'}` : ''}</span>
          <label className="flex cursor-pointer items-center gap-1.5">
            <Checkbox checked={internal} onChange={setInternal} ariaLabel="Show internal topics" />
            Show internal
          </label>
        </div>
      )}

      {creating && (
        <CreateTopicDialog
          conn={conn}
          topics={topics || []}
          brokerCount={overview?.brokers.length || 1}
          onClose={() => setCreating(false)}
          onCreated={(name) => {
            setCreating(false)
            loadTopics()
            onOpenTopic(name)
          }}
          onOpenInConsole={(command) => {
            setCreating(false)
            onRunCommand(command)
          }}
        />
      )}
    </>
  )
}
