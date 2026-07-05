import { useEffect, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import Popover from '@/shared/ui/overlay/Popover'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CloudIcon, EditIcon, MoreVerticalIcon, PlusIcon, TrashIcon } from '@/shared/ui/icons'
import { listStorages, deleteStorage } from '@/features/backup/lib/api'
import type { StorageDestination } from '@/features/backup/lib/types'
import StorageModal from './StorageModal'

// List + create/edit/delete for a workspace's S3-compatible storage destinations.
export default function StorageList({ workspaceId }: { workspaceId: string }) {
  const toast = useToast()
  const [storages, setStorages] = useState<StorageDestination[]>([])
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
      <div className="flex items-center justify-between">
        <p className="max-w-[560px] text-[12px] text-ink-dim">
          S3-compatible storage destinations (AWS S3, MinIO, R2, B2, …) that connections can back up to.
        </p>
        <Button variant="primary" size="sm" icon={PlusIcon} onClick={() => setModal({ mode: 'new' })}>
          Add destination
        </Button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-xs text-ink-faint">Loading…</div>
      ) : storages.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-card border border-dashed border-edge-strong py-16">
          <CloudIcon width={28} height={28} className="text-ink-faint" />
          <div className="text-[13px] text-ink-dim">No storage destinations yet.</div>
          <Button variant="ghost" size="sm" icon={PlusIcon} onClick={() => setModal({ mode: 'new' })}>
            Add your first destination
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 max-[720px]:grid-cols-1">
          {storages.map((s) => (
            <div key={s.id} className="group relative flex flex-col rounded-card border border-edge bg-card p-5">
              <div className="flex items-start justify-between">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-elevated text-sky-400">
                  <CloudIcon width={20} height={20} />
                </span>
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
        </div>
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
}
