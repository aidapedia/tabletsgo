import { useEffect, useState } from 'react'
import { useConnections } from '@/features/connections'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import Select from '@/shared/ui/form/Select'
import { controlClass } from '@/shared/ui/form/Input'
import { FormField } from '@/shared/ui/form/Form'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import TypeToConfirmDialog from '@/shared/ui/feedback/TypeToConfirmDialog'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import { useToast } from '@/shared/ui/feedback/Toast'
import { ChevronLeft, ChevronRight, CloseIcon, DownloadIcon, HistoryIcon, RestoreIcon, ShieldIcon, TrashIcon } from '@/shared/ui/icons'
import { deleteBackupUpload, downloadBackupUpload, listBackupRuns, listStorages, restoreBackup } from '@/features/backup/lib/api'
import type { BackupRun, BackupUpload, StorageDestination } from '@/features/backup/lib/types'

const PAGE_SIZE = 20

const fmtDate = (ts: number) => new Date(ts).toLocaleString()
const fmtBytes = (n?: number) => {
  if (!n) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

type Row = { run: BackupRun; upload: BackupUpload }

// Flattened version list: one row per (run, destination-upload) pair, since
// restore/download/delete all act on a specific uploaded artifact, not a run
// as a whole. Paginated; optionally filtered to a single day (heatmap click).
export default function BackupVersionList({
  connectionId,
  connectionType,
  workspaceId,
  dateFilter,
  onClearDateFilter,
}: {
  connectionId: string
  connectionType: string
  workspaceId: string
  dateFilter?: string | null
  onClearDateFilter?: () => void
}) {
  const toast = useToast()
  const { connections } = useConnections() as { connections: any[] }
  const [runs, setRuns] = useState<BackupRun[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [storageNames, setStorageNames] = useState<Record<string, string>>({})
  const [restoreTarget, setRestoreTarget] = useState<{ runId: string; destinationId: string; targetConnectionId: string; confirming: boolean } | null>(
    null
  )
  const [deleteTarget, setDeleteTarget] = useState<{ runId: string; destinationId: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => setPage(0), [dateFilter])

  const load = () => {
    setLoading(true)
    Promise.all([
      listBackupRuns(connectionId, { limit: PAGE_SIZE, offset: page * PAGE_SIZE, date: dateFilter || undefined }),
      listStorages(workspaceId),
    ]).then(([page_, storages]) => {
      setRuns(page_.runs)
      setTotal(page_.total)
      setStorageNames(Object.fromEntries(storages.map((s: StorageDestination) => [s.id, s.name])))
      setLoading(false)
    })
  }
  useEffect(load, [connectionId, workspaceId, page, dateFilter])

  const sameTypeConnections = connections.filter((c) => c.type === connectionType)

  const rows: Row[] = runs.flatMap((run) => run.uploads.map((upload) => ({ run, upload })))

  const doRestore = async () => {
    if (!restoreTarget) return
    const target = connections.find((c) => c.id === restoreTarget.targetConnectionId)
    if (!target) return
    setBusy(true)
    try {
      await restoreBackup(connectionId, {
        runId: restoreTarget.runId,
        destinationId: restoreTarget.destinationId,
        confirmName: target.name,
        targetConnectionId: restoreTarget.targetConnectionId,
      })
      toast.success(`Restored into "${target.name}".`)
      setRestoreTarget(null)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await deleteBackupUpload(connectionId, deleteTarget.runId, deleteTarget.destinationId)
      toast.success('Backup version deleted.')
      setDeleteTarget(null)
      load()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  const doDownload = async (runId: string, destinationId: string) => {
    try {
      await downloadBackupUpload(connectionId, runId, destinationId)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const restoreTargetConn = restoreTarget ? connections.find((c) => c.id === restoreTarget.targetConnectionId) : null

  return (
    <>
      <div className="rounded-card border border-edge bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-edge px-5 py-3.5">
          <div className="flex items-center gap-2 text-[13px] font-bold">
            <HistoryIcon width={14} height={14} /> Backup versions
          </div>
          {dateFilter && (
            <button
              onClick={onClearDateFilter}
              className="flex items-center gap-1.5 rounded-[6px] border border-edge bg-elevated px-2 py-1 text-[11px] text-ink-dim hover:text-ink"
            >
              Filtered to {dateFilter}
              <CloseIcon width={11} height={11} />
            </button>
          )}
        </div>

        {loading ? (
          <div className="py-10 text-center text-xs text-ink-faint">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-[12px] text-ink-faint">No backup versions{dateFilter ? ' on this day' : ' yet'}.</div>
        ) : (
          <div className="flex flex-col divide-y divide-edge">
            {rows.map(({ run, upload }) => (
              <div key={`${run.id}-${upload.destinationId}`} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${upload.ok && !upload.deleted ? 'bg-green' : 'bg-red'}`} />
                    <span className="font-medium">{fmtDate(run.startedAt)}</span>
                    <span className="text-ink-faint">· {run.trigger}</span>
                    <span className="text-ink-faint">· {storageNames[upload.destinationId] || 'storage'}</span>
                    {upload.encrypted && <ShieldIcon width={11} height={11} className="shrink-0 text-ink-faint" />}
                  </div>
                  <div className="mt-1 text-[11px] text-ink-faint">
                    {upload.deleted ? 'Deleted from storage' : upload.ok ? fmtBytes(upload.sizeBytes) : upload.error}
                  </div>
                </div>
                {upload.ok && !upload.deleted && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Tooltip label="Restore">
                      <TextButton
                        tone="faint"
                        onClick={() =>
                          setRestoreTarget({ runId: run.id, destinationId: upload.destinationId, targetConnectionId: connectionId, confirming: false })
                        }
                        aria-label="Restore"
                      >
                        <RestoreIcon width={15} height={15} />
                      </TextButton>
                    </Tooltip>
                    <Tooltip label="Download">
                      <TextButton tone="faint" onClick={() => doDownload(run.id, upload.destinationId)} aria-label="Download">
                        <DownloadIcon width={15} height={15} />
                      </TextButton>
                    </Tooltip>
                    <Tooltip label="Delete">
                      <TextButton
                        tone="faint"
                        className="hover:!text-red"
                        onClick={() => setDeleteTarget({ runId: run.id, destinationId: upload.destinationId })}
                        aria-label="Delete"
                      >
                        <TrashIcon width={15} height={15} />
                      </TextButton>
                    </Tooltip>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-edge px-5 py-3">
            <TextButton tone="faint" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft width={14} height={14} /> Prev
            </TextButton>
            <span className="text-[11px] text-ink-faint">
              {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
            </span>
            <TextButton tone="faint" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight width={14} height={14} />
            </TextButton>
          </div>
        )}
      </div>

      {restoreTarget && !restoreTarget.confirming && (
        <div className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]" onMouseDown={() => setRestoreTarget(null)}>
          <div
            className="w-full max-w-[420px] animate-pop rounded-[16px] border border-edge-strong bg-panel p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-ink">Restore backup</h3>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">Choose which connection to overwrite with this backup.</p>
            <FormField label="Restore into" className="mt-4">
              <Select
                className={controlClass}
                value={restoreTarget.targetConnectionId}
                options={sameTypeConnections.map((c) => ({ value: c.id, label: c.id === connectionId ? `${c.name} (this connection)` : c.name }))}
                onChange={(v) => setRestoreTarget((t) => (t ? { ...t, targetConnectionId: v } : t))}
              />
            </FormField>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="subtle" size="sm" onClick={() => setRestoreTarget(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={() => setRestoreTarget((t) => (t ? { ...t, confirming: true } : t))}>
                Continue
              </Button>
            </div>
          </div>
        </div>
      )}

      {restoreTarget?.confirming && (
        <TypeToConfirmDialog
          title={`Restore into "${restoreTargetConn?.name || ''}"?`}
          message="This overwrites the target connection's live data with this backup. This can't be undone."
          confirmText={restoreTargetConn?.name || ''}
          confirmLabel={busy ? 'Restoring…' : 'Restore'}
          onConfirm={doRestore}
          onCancel={() => !busy && setRestoreTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this backup version?"
          message="This permanently deletes the file from storage. This can't be undone."
          confirmLabel={busy ? 'Deleting…' : 'Delete'}
          cancelLabel="Cancel"
          danger
          onConfirm={doDelete}
          onCancel={() => !busy && setDeleteTarget(null)}
        />
      )}
    </>
  )
}
