import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import SearchInput from '@/shared/ui/form/SearchInput'
import Badge from '@/shared/ui/Badge'
import DataTable from '@/shared/ui/table/DataTable'
import type { Column } from '@/shared/ui/table/DataTable'
import { RowActions, RowMenu } from '@/shared/ui/table/RowActions'
import useDataTable from '@/shared/ui/table/useDataTable'
import { CloudIcon, EditIcon, PlusIcon, TrashIcon } from '@/shared/ui/icons'
import { listStorages, deleteStorage } from '@/features/backup/lib/api'
import type { StorageDestination } from '@/features/backup/lib/types'
import StorageModal from './StorageModal'

export type StorageListHandle = { openCreate: () => void }

// A destination without an endpoint is plain AWS S3; otherwise the endpoint's
// host is the closest thing to a provider name (minio, r2, b2, …).
function providerOf(s: StorageDestination) {
  if (!s.endpoint) return 'AWS S3'
  try {
    return new URL(s.endpoint.includes('://') ? s.endpoint : `https://${s.endpoint}`).host
  } catch {
    return s.endpoint
  }
}

// List + create/edit/delete for a workspace's S3-compatible storage destinations.
// Exposes `openCreate` via ref so a page header can drive the "new" action.
// `canManage` (workspace owner) gates the write actions — members can see which
// destinations exist, since backups they look at land there, but not repoint them.
const StorageList = forwardRef<StorageListHandle, { workspaceId: string; canManage?: boolean }>(function StorageList(
  { workspaceId, canManage = true },
  ref
) {
  const toast = useToast()
  const [storages, setStorages] = useState<StorageDestination[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ mode: 'new' | 'edit'; storage?: StorageDestination } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<StorageDestination | null>(null)

  const reload = () => {
    if (!workspaceId) return
    setLoading(true)
    listStorages(workspaceId).then((list) => {
      setStorages(list)
      setLoading(false)
    })
  }

  useEffect(reload, [workspaceId])

  useImperativeHandle(ref, () => ({ openCreate: () => setModal({ mode: 'new' }) }), [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return storages
    return storages.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.bucket?.toLowerCase().includes(q) ||
        s.endpoint?.toLowerCase().includes(q) ||
        s.region?.toLowerCase().includes(q),
    )
  }, [storages, query])

  // Everything a row shows is derived here so the table stays generic; sorting
  // uses `sortValue` wherever the cell isn't plain text.
  const columns = useMemo<Column<StorageDestination>[]>(
    () => [
      {
        key: 'name',
        header: 'Destination',
        sortable: true,
        sortValue: (s) => s.name,
        render: (s) => (
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-elevated text-sky-400">
              <CloudIcon width={18} height={18} />
            </span>
            <div className="min-w-0">
              <div className="truncate font-semibold">{s.name}</div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">{providerOf(s)}</div>
            </div>
          </div>
        ),
      },
      {
        key: 'bucket',
        header: 'Bucket',
        sortable: true,
        sortValue: (s) => s.bucket || '',
        width: 200,
        render: (s) => <span className="block truncate font-mono text-[12px]">{s.bucket || '—'}</span>,
      },
      {
        key: 'pathPrefix',
        header: 'Prefix',
        sortable: true,
        sortValue: (s) => s.pathPrefix || '',
        width: 170,
        className: 'max-[1080px]:hidden',
        render: (s) => (
          <span className="block truncate font-mono text-[12px] text-ink-dim">{s.pathPrefix || '—'}</span>
        ),
      },
      {
        key: 'region',
        header: 'Region',
        sortable: true,
        sortValue: (s) => s.region || '',
        width: 140,
        className: 'max-[900px]:hidden',
        render: (s) => <span className="text-ink-dim">{s.region || '—'}</span>,
      },
      {
        key: 'forcePathStyle',
        header: 'Addressing',
        sortable: true,
        sortValue: (s) => (s.forcePathStyle ? 'path' : 'virtual'),
        width: 130,
        className: 'max-[900px]:hidden',
        render: (s) => <Badge>{s.forcePathStyle ? 'Path' : 'Virtual'}</Badge>,
      },
      ...(canManage
        ? [
            {
              key: 'actions',
              header: '',
              align: 'right' as const,
              width: 60,
              render: (s: StorageDestination) => (
                <RowActions>
                  <RowMenu label={`Actions for ${s.name}`} width={160}>
                    {({ close }) => (
                      <div className="p-1">
                        <MenuItem onClick={() => { close(); setModal({ mode: 'edit', storage: s }) }}>
                          <EditIcon width={14} height={14} /> Edit
                        </MenuItem>
                        <div className="my-1 h-px bg-edge" />
                        <MenuItem danger onClick={() => { close(); setPendingDelete(s) }}>
                          <TrashIcon width={14} height={14} /> Delete
                        </MenuItem>
                      </div>
                    )}
                  </RowMenu>
                </RowActions>
              ),
            },
          ]
        : []),
    ],
    [canManage],
  )

  // Client-side sort + paging; changing the search sends the table back to page 1.
  const table = useDataTable({ rows: filtered, columns, pageSize: 10, resetKey: query })

  const handleSaved = (s: StorageDestination) => {
    setStorages((prev) => (prev.some((x) => x.id === s.id) ? prev.map((x) => (x.id === s.id ? s : x)) : [...prev, s]))
    setModal(null)
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    try {
      await deleteStorage(pendingDelete.id)
      setStorages((prev) => prev.filter((s) => s.id !== pendingDelete.id))
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setPendingDelete(null)
    }
  }

  return (
    <>
      <div className="mb-4">
        <SearchInput
          placeholder="Search storage destinations…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <DataTable
        columns={columns}
        rowKey={(s) => s.id}
        onRowClick={canManage ? (s) => setModal({ mode: 'edit', storage: s }) : undefined}
        loading={loading}
        empty={
          query.trim() ? (
            'No storage destinations match your search.'
          ) : (
            <div className="flex flex-col items-center gap-3">
              <CloudIcon width={28} height={28} className="text-ink-faint" />
              <span>No storage destinations yet.</span>
              {canManage && (
                <Button variant="primary" size="sm" icon={PlusIcon} onClick={() => setModal({ mode: 'new' })}>
                  Add your first destination
                </Button>
              )}
            </div>
          )
        }
        {...table}
      />

      {modal && (
        <StorageModal
          workspaceId={workspaceId}
          initial={modal.mode === 'edit' ? modal.storage : null}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.name}"?`}
          message="Any backup schedule using this destination will fail until it's replaced. This can't be undone."
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  )
})

export default StorageList
