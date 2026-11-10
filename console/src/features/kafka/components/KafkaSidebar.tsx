import { useEffect, useMemo, useState } from 'react'
import RefreshButton from '@/shared/ui/RefreshButton'
import ListRow from '@/shared/ui/ListRow'
import RowLabel from '@/shared/ui/RowLabel'
import Popover from '@/shared/ui/overlay/Popover'
import SearchInput from '@/shared/ui/form/SearchInput'
import {
  ChevronRight,
  FolderIcon,
  FolderOpenIcon,
  MoreVerticalIcon,
  PlusIcon,
  SearchIcon,
  TopicIcon,
} from '@/shared/ui/icons'
import { getOverview, listTopics, type StreamOverview, type TopicSummary } from '../lib/api'
import { buildTopicTree } from '../lib/format'
import ClearTopicDialog from './ClearTopicDialog'
import CreateTopicDialog from './CreateTopicDialog'
import DeleteTopicDialog from './DeleteTopicDialog'
import TopicMenuItems from './TopicMenuItems'
import { type TopicSubView } from './TopicView'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

/**
 * The console's sidebar for a stream engine: the cluster's topics, grouped by
 * their dotted prefix — consumer groups are a rail entry of their own, the
 * cluster-wide views (brokers, ACLs) toolbar buttons. Opening a topic opens a tab; the
 * console owns the tabs. A topic row opens its messages; its
 * other views (partitions, consumers, configuration) are tabs of their own,
 * reached from the row's menu.
 */
export default function KafkaSidebar({
  conn,
  activeTopic,
  onOpenTopic,
  onProduce,
  onRunCommand,
  onTopicDeleted,
  onTopicCleared,
}: {
  conn: any
  activeTopic?: string | null
  onOpenTopic: (topic: string, view?: TopicSubView) => void
  onProduce: (topic: string) => void
  onRunCommand: (command: string) => void
  onTopicDeleted: (topic: string) => void
  onTopicCleared: (topic: string) => void
}) {
  const [filter, setFilter] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [internal, setInternal] = useState(false)
  const [overview, setOverview] = useState<StreamOverview | null>(null)
  const [topics, setTopics] = useState<TopicSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(() => new Set<string>())
  // `true` for a new topic, a topic's name to clone it.
  const [creating, setCreating] = useState<boolean | string>(false)
  const [deleting, setDeleting] = useState<TopicSummary | null>(null)
  const [clearing, setClearing] = useState<string | null>(null)

  const loadTopics = () =>
    listTopics(conn, { internal })
      .then((list) => {
        setTopics(list)
        setError(null)
      })
      .catch((e) => setError(e.message))
  const reload = () =>
    Promise.all([getOverview(conn).then(setOverview).catch(() => {}), loadTopics()])

  useEffect(() => {
    getOverview(conn).then(setOverview).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.id])
  useEffect(() => {
    loadTopics()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.id, internal])

  const needle = filter.trim().toLowerCase()
  const shownTopics = useMemo(() => (topics || []).filter((t) => !needle || t.name.toLowerCase().includes(needle)), [topics, needle])
  const tree = useMemo(() => buildTopicTree(shownTopics), [shownTopics])

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const collapseAll = () => setCollapsed(new Set(tree.flatMap((n) => (n.kind === 'topic' ? [] : [n.id]))))
  const expandAll = () => setCollapsed(new Set())
  // One button flips between the two: anything folded means "expand" is next.
  const anyCollapsed = collapsed.size > 0

  const topicRow = (t: TopicSummary, depth: number) => (
    <ListRow
      key={t.name}
      style={{ paddingLeft: `${10 + depth * 18}px` }}
      active={activeTopic === t.name}
      onClick={() => onOpenTopic(t.name)}
      title={t.name}
      icon={<TopicIcon width={14} height={14} className={`shrink-0 ${activeTopic === t.name ? 'text-primary' : 'text-faint'}`} />}
      trailing={
        <Popover
          align="right"
          width={210}
          portal
          trigger={({ open, toggle: toggleMenu }) => (
            <Button variant="ghost" size="icon-xs"
              aria-pressed={open}
              data-row-menu aria-expanded={open}
              onClick={toggleMenu}
              aria-label={`${t.name} actions`}
              className={open ? 'opacity-100' : '!text-faint opacity-0 group-hover:opacity-100'}
            >
              <MoreVerticalIcon width={15} height={15} />
            </Button>
          )}
        >
          {({ close }) => (
            <div className="p-1">
              <TopicMenuItems
                topic={t.name}
                close={close}
                onOpenView={(id) => onOpenTopic(t.name, id)}
                onProduce={() => onProduce(t.name)}
                onRunCommand={onRunCommand}
                onClone={() => setCreating(t.name)}
                onClear={() => setClearing(t.name)}
                onDelete={() => setDeleting(t)}
              />
            </div>
          )}
        </Popover>
      }
    >
      <RowLabel className={activeTopic === t.name ? 'font-medium' : ''}>{depth ? t.name.slice(t.name.indexOf('.') + 1) : t.name}</RowLabel>
      {t.underReplicated > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
          </TooltipTrigger>
          <TooltipContent side="right">{`${t.underReplicated} under-replicated partition(s)`}</TooltipContent>
        </Tooltip>
      )}
      <span className="shrink-0 font-mono text-[10px] text-faint">{t.partitions}</span>
    </ListRow>
  )

  return (
    <>
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <span className="text-xs font-semibold">Topics</span>
        <div className="flex gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <RefreshButton onRefresh={reload} aria-label="Refresh topics" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">Refresh</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm"
                aria-pressed={searchOpen}
                onClick={() => {
                  if (searchOpen) setFilter('')
                  setSearchOpen((o) => !o)
                }}
                aria-label="Search topics"
              >
                <SearchIcon width={15} height={15} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Search topics</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={anyCollapsed ? expandAll : collapseAll} aria-label={anyCollapsed ? 'Expand all prefixes' : 'Collapse all prefixes'}>
                {anyCollapsed ? <FolderOpenIcon width={15} height={15} /> : <FolderIcon width={15} height={15} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{anyCollapsed ? 'Expand all' : 'Collapse all'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => setCreating(true)} aria-label="New topic">
                <PlusIcon width={15} height={15} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New topic</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {searchOpen && (
        <SearchInput
          autoFocus
          className="mx-3.5 mb-2"
          placeholder="Filter topics"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setFilter('')
              setSearchOpen(false)
            }
          }}
          inputClassName="!rounded-[9px] !text-xs"
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {error && <div className="m-2 rounded-[9px] border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-[11px] text-[#ff9b9b]">{error}</div>}

        {!error && (
          <>
            {topics === null && <div className="p-6 text-center text-xs text-faint">Loading topics…</div>}
            {topics !== null && !shownTopics.length && (
              <div className="p-6 text-center text-xs text-faint">{needle ? `No topics match "${filter.trim()}".` : 'This cluster has no topics yet.'}</div>
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
                        <ChevronRight width={12} height={12} className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
                        {open ? (
                          <FolderOpenIcon width={14} height={14} className="shrink-0 text-faint" />
                        ) : (
                          <FolderIcon width={14} height={14} className="shrink-0 text-faint" />
                        )}
                      </>
                    }
                  >
                    <RowLabel className="font-medium">{node.label}</RowLabel>
                    <span className="shrink-0 text-[10px] text-faint">{node.children.length}</span>
                  </ListRow>
                  {open && node.children.map((t) => topicRow(t, 1))}
                </div>
              )
            })}
          </>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[10px] text-faint">
        <span>{topics ? `${shownTopics.length} topic${shownTopics.length === 1 ? '' : 's'}` : ''}</span>
        <label className="flex cursor-pointer items-center gap-1.5">
          <Checkbox onClick={(e) => e.stopPropagation()} checked={internal} onCheckedChange={(checked) => setInternal(checked === true)} aria-label="Show internal topics" />
          Show internal
        </label>
      </div>

      {creating && (
        <CreateTopicDialog
          conn={conn}
          topics={topics || []}
          brokerCount={overview?.brokers.length || undefined}
          cloneOf={typeof creating === 'string' ? creating : undefined}
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

      {clearing && (
        <ClearTopicDialog
          conn={conn}
          topic={clearing}
          onClose={() => setClearing(null)}
          onCleared={(topic) => {
            loadTopics()
            onTopicCleared(topic)
          }}
        />
      )}

      {deleting && (
        <DeleteTopicDialog
          conn={conn}
          topic={deleting.name}
          partitions={deleting.partitions}
          onClose={() => setDeleting(null)}
          onDeleted={onTopicDeleted}
        />
      )}
    </>
  )
}

