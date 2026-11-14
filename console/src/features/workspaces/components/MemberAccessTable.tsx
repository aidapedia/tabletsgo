import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import useDataTable from '@/shared/ui/table/useDataTable'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import { Badge } from '@/shared/ui/badge'
import { BuildingIcon, CloudIcon, DatabaseIcon, UsersIcon } from '@/shared/ui/icons'
import type { MemberAccess } from '../api'
import { viaLabel } from '../lib/grants'

const KIND: Record<MemberAccess['kind'], { label: string; Icon: (p: any) => ReactNode }> = {
  workspace: { label: 'Workspace', Icon: BuildingIcon },
  group: { label: 'Group', Icon: UsersIcon },
  connection: { label: 'Connection', Icon: DatabaseIcon },
  storage: { label: 'S3 storage', Icon: CloudIcon },
}

// Where a row opens: tabletsgo's own resources have pages; the workspace and
// its groups are Hayat's.
const linkFor = (a: MemberAccess) => (a.kind === 'connection' ? `/connections/${a.id}` : a.kind === 'storage' ? '/storage' : null)

/**
 * A member's Access list: each grant that reaches them and each thing they own,
 * one row apiece — the same resource can appear twice when two grants reach it.
 */
export default function MemberAccessTable({ access }: { access: MemberAccess[] }) {
  const navigate = useNavigate()

  const columns: Column<MemberAccess>[] = [
    {
      key: 'resource',
      header: 'Resource',
      sortable: true,
      sortValue: (a) => `${a.kind} ${a.name}`,
      render: (a) => {
        const { label, Icon } = KIND[a.kind] || { label: a.kind, Icon: DatabaseIcon }
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon width={14} height={14} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[12px]">{a.name}</span>
              <span className="text-[10px] text-faint">{label}</span>
            </span>
          </div>
        )
      },
    },
    {
      key: 'role',
      header: 'Role',
      sortable: true,
      sortValue: (a) => a.roleName || '',
      render: (a) =>
        a.via === 'owner' ? (
          <Badge variant="default">owner</Badge>
        ) : (
          <Badge variant="secondary" className="normal-case tracking-normal text-[10px]">
            {a.roleName}
          </Badge>
        ),
    },
    {
      key: 'via',
      header: 'Through',
      sortable: true,
      sortValue: (a) => a.via,
      render: (a) => (
        <span className="text-xs text-muted-foreground">
          {viaLabel(a.via, a.groupName)}
          {/* On a workspace or group, an inheriting grant covers everything filed inside. */}
          {a.inherit && a.via !== 'owner' && (a.kind === 'workspace' || a.kind === 'group') && (
            <span className="text-faint"> · and everything inside</span>
          )}
        </span>
      ),
    },
  ]

  const table = useDataTable({ rows: access, columns, pageSize: 25 })

  return (
    <DataTable
      columns={columns}
      rowKey={(a) => `${a.kind}:${a.id}:${a.via}:${a.role || ''}:${a.groupName || ''}`}
      onRowClick={(a) => {
        const to = linkFor(a)
        if (to) navigate(to)
      }}
      rowClassName={(a) => (linkFor(a) ? '' : 'cursor-default')}
      empty={<EmptyState>Nothing is granted to them in this workspace yet.</EmptyState>}
      {...table}
    />
  )
}
