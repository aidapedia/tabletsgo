import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PersonRow from '@/shared/ui/PersonRow'
import SearchInput from '@/shared/ui/form/SearchInput'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import useDataTable from '@/shared/ui/table/useDataTable'
import useListView from '@/shared/ui/table/useListView'
import ViewToggle from '@/shared/ui/table/ViewToggle'
import { Badge } from '@/shared/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { listMembers, type Member } from '@/features/workspaces/api'
import { viaLabel } from '../lib/grants'

/**
 * The workspace's roster, read-only: it is the Hayat tenant's, and people are
 * invited, removed and given roles in Hayat's console (the page links there).
 * A row opens the member's page, with everything they were granted.
 */
export default function MembersPanel({ workspaceId }: { workspaceId: string }) {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    setLoading(true)
    listMembers(workspaceId).then((m) => {
      setMembers(m)
      setLoading(false)
    })
  }, [workspaceId])

  const q = query.trim().toLowerCase()
  const filtered = members.filter((m) => m.email.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q))

  const columns: Column<Member>[] = [
    {
      key: 'name',
      header: 'Member',
      sortable: true,
      sortValue: (m) => m.name || m.email,
      // PersonRow is a fragment for the caller's flex row; a table cell isn't one.
      render: (m) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <PersonRow stacked name={m.name} email={m.email} />
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (m) => m.status,
      width: 110,
      render: (m) =>
        m.status === 'active' ? (
          <Badge variant="default">active</Badge>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Badge variant="warning">{m.status}</Badge>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {m.status === 'pending' ? 'Invited in Hayat, and hasn’t chosen a password yet.' : 'Their Hayat account is disabled.'}
            </TooltipContent>
          </Tooltip>
        ),
    },
    {
      // The roles they hold on the workspace itself; what they were given on a
      // connection or a group is on their page.
      key: 'role',
      header: 'Role',
      sortable: true,
      sortValue: (m) => (m.isOwner ? '0' : '1') + (m.roles?.[0]?.name || '~'),
      render: (m) =>
        m.isOwner || m.roles?.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {m.isOwner && <Badge variant="default">owner</Badge>}
            {m.roles?.map((r) => (
              <Tooltip key={r.role}>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Badge variant="secondary" className="normal-case tracking-normal text-[10px]">
                      {r.name}
                    </Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">{viaLabel(r.via, r.groupName)}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        ) : (
          <span className="text-xs text-faint">No workspace role</span>
        ),
    },
  ]

  const [view, setView] = useListView('members')
  const table = useDataTable({ rows: filtered, columns, pageSize: 10, resetKey: query, view })

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput className="min-w-[220px] flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or email…" />
        <ViewToggle value={view} onChange={setView} />
      </div>
      <DataTable
        columns={columns}
        rowKey={(m) => m.userId}
        onRowClick={(m) => navigate(`/members/${m.userId}`)}
        loading={loading}
        empty={q ? <EmptyState>No members match that search.</EmptyState> : 'No members yet.'}
        {...table}
      />
    </div>
  )
}
