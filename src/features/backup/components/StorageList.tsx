import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import Popover from '@/shared/ui/overlay/Popover'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import SearchInput from '@/shared/ui/form/SearchInput'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import { CloudIcon, EditIcon, MoreVerticalIcon, PlusIcon, TrashIcon } from '@/shared/ui/icons'
import { listStorages, deleteStorage } from '@/features/backup/lib/api'
import type { StorageDestination } from '@/features/backup/lib/types'
import StorageModal from './StorageModal'
import LoadingState from '@/shared/ui/feedback/LoadingState'

export type StorageListHandle = { openCreate: () => void }

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
        s.endpoint?.toLowerCase().includes(q),
    )
  }, [storages, query])

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
      {loading ? (
        <LoadingState className="py-16 text-center" />
      ) : storages.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-edge-strong py-16">
          <CloudIcon width={28} height={28} className="text-ink-faint" />
          <div className="text-[13px] text-ink-dim">No storage destinations yet.</div>
          <Button variant="ghost" size="sm" icon={PlusIcon} onClick={() => setModal({ mode: 'new' })}>
            Add your first destination
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <SearchInput
              iconSize={16}
              placeholder="Search storage destinations…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              inputClassName="!py-2.5 !pl-10 !text-[13px]"
            />
          </div>
          <div className="grid grid-cols-3 gap-4 max-[1080px]:grid-cols-2 max-[720px]:grid-cols-1">
            {filtered.map((s) => (
            <div key={s.id} className="group relative flex flex-col rounded-card border border-edge bg-card p-5">
              <div className="flex items-start justify-between">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-elevated text-sky-400">
                  <CloudIcon width={20} height={20} />
                </span>
                {canManage && (
                <Popover
                  align="right"
                  width={160}
                  trigger={({ open, toggle }) => (
                    <IconButton onClick={toggle} active={open} aria-label="Storage actions" className={open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}>
                      <MoreVerticalIcon width={16} height={16} />
                    </IconButton>
                  )}
                >
                  {({ close }) => (
                    <div className="p-1">
                      <MenuItem onClick={() => { setModal({ mode: 'edit', storage: s }); close() }}>
                        <EditIcon width={14} height={14} /> Edit
                      </MenuItem>
                      <div className="my-1 h-px bg-edge" />
                      <MenuItem danger onClick={() => { setPendingDelete(s); close() }}>
                        <TrashIcon width={14} height={14} /> Delete
                      </MenuItem>
                    </div>
                  )}
                </Popover>
                )}
              </div>
              <div className="mt-4">
                <div className="truncate text-[15px] font-bold">{s.name}</div>
                <div className="mt-0.5 truncate font-mono text-[12px] text-ink-faint">
                  {s.bucket}
                  {s.endpoint ? ` · ${s.endpoint}` : ' · AWS S3'}
                </div>
              </div>
            </div>
            ))}

            {/* Add-destination card */}
            {!query.trim() && (
              <button
                onClick={() => setModal({ mode: 'new' })}
                className="flex min-h-[132px] flex-col items-center justify-center gap-3 rounded-card border border-dashed border-edge-strong text-ink-dim transition-colors hover:border-green-dim hover:text-ink"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-elevated text-green">
                  <PlusIcon width={20} height={20} />
                </span>
                <span className="text-[13px] font-medium">New destination</span>
              </button>
            )}
          </div>

          {filtered.length === 0 && (
            <EmptyState className="py-16">No storage destinations match your search.</EmptyState>
          )}
        </>
      )}

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
