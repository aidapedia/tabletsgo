import { useEffect, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import Badge from '@/shared/ui/Badge'
import Avatar from '@/shared/ui/Avatar'
import SearchInput from '@/shared/ui/form/SearchInput'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import TypeToConfirmDialog from '@/shared/ui/feedback/TypeToConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import { RowAction, RowActions } from '@/shared/ui/table/RowActions'
import useDataTable from '@/shared/ui/table/useDataTable'
import useListView from '@/shared/ui/table/useListView'
import ViewToggle from '@/shared/ui/table/ViewToggle'
import { PlusIcon, TrashIcon } from '@/shared/ui/icons'
import { deleteWorkspaceAs, listAllWorkspaces, type AdminWorkspace } from '../api'
import CreateWorkspaceDialog from './CreateWorkspaceDialog'

/**
 * Every workspace on the instance, and who owns it.
 *
 * An admin never joins a workspace, so there's no way in from here to a
 * connection or a database. A row opens the workspace's detail page, which is
 * where its roster and what it holds are; handing someone ownership is how work
 * gets done inside one.
 *
 * The "new workspace" dialog is controlled (`creating` / `onCreatingChange`) so
 * the page can put its button in the section header, next to the title — where
 * ConnectionsPage puts "New connection".
 */
export default function AdminWorkspacesPanel({
  creating,
  onCreatingChange,
  onOpen,
}: {
  creating: boolean
  onCreatingChange: (next: boolean) => void
  onOpen: (id: string) => void
}) {
  const toast = useToast()
  const [rows, setRows] = useState<AdminWorkspace[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [deleting, setDeleting] = useState<AdminWorkspace | null>(null)

  const load = async () => {
    setLoading(true)
    const list = await listAllWorkspaces()
    setRows(list)
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const filtered = rows.filter((w) => w.name.toLowerCase().includes(query.trim().toLowerCase()))

  const confirmDelete = async () => {
    const w = deleting
    setDeleting(null)
    if (!w) return
    try {
      const { connectionsDeleted } = await deleteWorkspaceAs(w.id)
      toast.success(`Deleted “${w.name}” and ${connectionsDeleted} connection${connectionsDeleted === 1 ? '' : 's'}.`)
      load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const columns: Column<AdminWorkspace>[] = [
    {
      key: 'name',
      header: 'Workspace',
      sortable: true,
      render: (w) => (
        <div className="flex items-center gap-2.5">
          <Avatar label={w.name} />
          <span className="truncate font-medium text-ink">{w.name}</span>
        </div>
      ),
    },
    {
      key: 'owners',
      header: 'Owners',
      sortable: true,
      sortValue: (w) => w.owners.length,
      // An ownerless workspace is a real state (its owners left, or an admin
      // created it and hasn't assigned one yet) and the one an admin must act on.
      render: (w) =>
        w.owners.length ? (
          <span className="truncate text-ink-dim">{w.owners.map((o) => o.name || o.email).join(', ')}</span>
        ) : (
          <Badge tone="amber">no owner</Badge>
        ),
    },
    { key: 'memberCount', header: 'Members', sortable: true, align: 'right', width: 90 },
    { key: 'connectionCount', header: 'Connections', sortable: true, align: 'right', width: 110 },
    {
      key: 'actions',
      header: '',
      width: 60,
      align: 'right',
      render: (w) => (
        <RowActions>
          <RowAction
            icon={TrashIcon}
            label="Delete"
            aria={`Delete ${w.name}`}
            tone="danger"
            onClick={() => setDeleting(w)}
          />
        </RowActions>
      ),
    },
  ]

  const [view, setView] = useListView('admin-workspaces')
  const table = useDataTable({ rows: filtered, columns, pageSize: 10, resetKey: query, view })

  return (
    <div>
      {/* Search — bare row, same shape as the connections list. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-[220px] flex-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search workspaces…"
        />
        <ViewToggle value={view} onChange={setView} />
      </div>

      <DataTable
        columns={columns}
        rowKey={(w) => w.id}
        onRowClick={(w) => onOpen(w.id)}
        loading={loading}
        empty={
          query.trim() ? (
            <EmptyState>No workspaces match that search.</EmptyState>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <span>No workspaces yet — create one and hand it to an owner.</span>
              <Button variant="primary" size="sm" icon={PlusIcon} onClick={() => onCreatingChange(true)}>
                Add new workspace
              </Button>
            </div>
          )
        }
        {...table}
      />

      {creating && (
        <CreateWorkspaceDialog
          onClose={() => onCreatingChange(false)}
          onCreated={() => {
            onCreatingChange(false)
            load()
          }}
        />
      )}

      {deleting && (
        <TypeToConfirmDialog
          title="Delete workspace?"
          message={`This permanently deletes “${deleting.name}”, its ${deleting.connectionCount} connection(s), groups and everything stored against them. Type the workspace name to confirm.`}
          confirmText={deleting.name}
          confirmLabel="Delete workspace"
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
