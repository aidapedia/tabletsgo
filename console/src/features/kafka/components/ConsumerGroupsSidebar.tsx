import { useCallback, useEffect, useMemo, useState } from 'react'
import RefreshButton from '@/shared/ui/RefreshButton'
import ListRow from '@/shared/ui/ListRow'
import RowLabel from '@/shared/ui/RowLabel'
import SearchInput from '@/shared/ui/form/SearchInput'
import { ChevronRight, FolderIcon, FolderOpenIcon, SearchIcon, UserIcon } from '@/shared/ui/icons'
import { describeGroup, listGroups, type GroupDetail, type GroupSummary } from '../lib/api'
import { compact, groupStateLook, lagTone } from '../lib/format'
import { Button } from '@/shared/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

/**
 * The console's sidebar for the cluster's consumer groups (their own rail
 * entry, under Topics): most lag first. A group opens in a tab; its chevron
 * unfolds the consumers in it — client, host and what each is assigned — read
 * when first unfolded.
 */
export default function ConsumerGroupsSidebar({
  conn,
  activeGroup,
  onOpenGroup,
}: {
  conn: any
  activeGroup?: string | null
  onOpenGroup: (group: string) => void
}) {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [open, setOpen] = useState(() => new Set<string>())
  // Per group: its members once read, or the error reading them.
  const [members, setMembers] = useState<Record<string, GroupDetail['members'] | { error: string }>>({})

  const readMembers = (id: string) =>
    describeGroup(conn, id)
      .then((d) => setMembers((m) => ({ ...m, [id]: d.members })))
      .catch((e) => setMembers((m) => ({ ...m, [id]: { error: e.message } })))

  const load = useCallback(
    () =>
      listGroups(conn)
        .then((list) => {
          setGroups(list)
          setError(null)
        })
        .catch((e) => setError(e.message)),
    [conn]
  )
  useEffect(() => {
    load()
  }, [load])

  // A refresh re-reads the groups and whichever are unfolded.
  const reload = () => {
    setMembers({})
    return Promise.all([load(), ...[...open].map(readMembers)])
  }

  const toggle = (id: string) => {
    setOpen((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    if (!open.has(id) && !members[id]) readMembers(id)
  }

  const consumers = (groups || []).reduce((n, g) => n + g.members, 0)
  const needle = filter.trim().toLowerCase()
  const shown = useMemo(
    () => (groups || []).filter((g) => !needle || g.id.toLowerCase().includes(needle)).sort((a, b) => b.lag - a.lag || a.id.localeCompare(b.id)),
    [groups, needle]
  )

  // Unfolds the groups in view, reading the consumers of any not read yet.
  const expandAll = () => {
    setOpen(new Set(shown.map((g) => g.id)))
    shown.forEach((g) => !members[g.id] && readMembers(g.id))
  }
  const collapseAll = () => setOpen(new Set())
  // One button flips between the two: anything unfolded means "collapse" is next.
  const anyOpen = open.size > 0

  const memberRows = (id: string) => {
    const list = members[id]
    if (!list) return <div className="py-1.5 pl-[42px] text-[10px] text-faint">Reading consumers…</div>
    if ('error' in list) return <div className="py-1.5 pl-[42px] pr-2 text-[10px] text-destructive">{list.error}</div>
    if (!list.length) return <div className="py-1.5 pl-[42px] text-[10px] text-faint">No consumers connected.</div>
    return list.map((m) => {
      const topics = Object.keys(m.assignment)
      const partitions = Object.values(m.assignment).reduce((n, ps) => n + ps.length, 0)
      return (
        <ListRow
          key={m.memberId}
          style={{ paddingLeft: '28px' }}
          onClick={() => onOpenGroup(id)}
          title={`${m.memberId}\n${topics.map((t) => `${t}: ${m.assignment[t].join(', ')}`).join('\n')}`}
          icon={<UserIcon width={13} height={13} className="shrink-0 text-faint" />}
        >
          <span className="min-w-0 flex-1">
            <RowLabel className="block">{m.clientId || m.memberId}</RowLabel>
            <span className="block truncate text-[10px] text-faint">
              {m.host.replace(/^\//, '')} · {partitions} partition{partitions === 1 ? '' : 's'}
              {topics.length > 1 ? ` across ${topics.length} topics` : topics.length ? ` of ${topics[0]}` : ''}
            </span>
          </span>
        </ListRow>
      )
    })
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <span className="text-xs font-semibold">Consumer groups</span>
        <div className="flex gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <RefreshButton onRefresh={reload} aria-label="Refresh groups" />
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
                aria-label="Search groups"
              >
                <SearchIcon width={15} height={15} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Search groups</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button variant="ghost" size="icon-sm"
                  onClick={anyOpen ? collapseAll : expandAll}
                  disabled={!anyOpen && !shown.length}
                  aria-label={anyOpen ? 'Collapse all groups' : 'Expand all groups'}
                >
                  {anyOpen ? <FolderIcon width={15} height={15} /> : <FolderOpenIcon width={15} height={15} />}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{anyOpen ? 'Collapse all' : 'Expand all'}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {searchOpen && (
        <SearchInput
          autoFocus
          className="mx-3.5 mb-2"
          placeholder="Filter groups"
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
        {!error && groups === null && <div className="p-6 text-center text-xs text-faint">Loading consumer groups…</div>}
        {!error && groups && !shown.length && (
          <div className="p-6 text-center text-xs text-faint">{needle ? `No groups match "${filter.trim()}".` : 'No consumer groups on this cluster.'}</div>
        )}
        {shown.map((g) => {
          const look = groupStateLook(g.state)
          const unfolded = open.has(g.id)
          return (
            <div key={g.id}>
              <ListRow
                active={activeGroup === g.id}
                onClick={() => onOpenGroup(g.id)}
                title={g.id}
                icon={
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggle(g.id)
                      }}
                      aria-label={unfolded ? `Hide ${g.id}'s consumers` : `Show ${g.id}'s consumers`}
                      aria-expanded={unfolded}
                      className="-m-1 shrink-0 rounded p-1 text-faint hover:text-foreground"
                    >
                      <ChevronRight width={12} height={12} className={`transition-transform ${unfolded ? 'rotate-90' : ''}`} />
                    </button>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${look.dot}`} />
                  </>
                }
                className="!py-2"
              >
                <span className="min-w-0 flex-1">
                  <RowLabel className={`block ${activeGroup === g.id ? 'font-medium' : ''}`}>{g.id}</RowLabel>
                  <span className="block text-[10px] text-faint">
                    {look.label} · {g.members} consumer{g.members === 1 ? '' : 's'}
                  </span>
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className={`shrink-0 font-mono text-[10px] ${lagTone(g.lag)}`}>{compact(g.lag)}</span>
                  </TooltipTrigger>
                  <TooltipContent side="right">Lag</TooltipContent>
                </Tooltip>
              </ListRow>
              {unfolded && memberRows(g.id)}
            </div>
          )
        })}
      </div>

      {groups && (
        <div className="border-t border-border px-4 py-2 text-[10px] text-faint">
          {groups.length} group{groups.length === 1 ? '' : 's'} · {consumers} consumer{consumers === 1 ? '' : 's'}
        </div>
      )}
    </>
  )
}
