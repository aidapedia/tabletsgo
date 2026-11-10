import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, CloseIcon, DownloadIcon, HistoryIcon, RestoreIcon, SettingsIcon, ShieldIcon, TrashIcon } from '@/shared/ui/icons'
import { deleteBackupUpload, downloadBackupUpload, listBackupRuns, listStorages, restoreBackup } from '@/features/backup/lib/api'
import type { BackupRun, BackupUpload, StorageDestination } from '@/features/backup/lib/types'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { formatDateTime } from '@/shared/lib/datetime'
import { Button } from '@/shared/ui/button'
import OptionSelect from '@/shared/ui/form/OptionSelect'
import { FormField } from '@/shared/ui/form/FormField'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'

const PAGE_SIZE = 20

const fmtDate = (ts: number) => formatDateTime(ts)
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
  connections,
  workspaceId,
  dateFilter,
  onClearDateFilter,
}: {
  connectionId: string
  connectionType: string
  connections: { id: string; name: string; type: string }[]
  workspaceId: string
  dateFilter?: string | null
  onClearDateFilter?: () => void
}) {
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
      setStorageNames({ local: 'Local server disk', ...Object.fromEntries(storages.map((s: StorageDestination) => [s.id, s.name])) })
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

  const doDownload = async (runId: string, destinationId: string, artifact: 'dump' | 'config' = 'dump') => {
    try {
      await downloadBackupUpload(connectionId, runId, destinationId, artifact)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const restoreTargetConn = restoreTarget ? connections.find((c) => c.id === restoreTarget.targetConnectionId) : null

  return (
    <>
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2 text-[13px] font-bold">
            <HistoryIcon width={14} height={14} /> Backup versions
          </div>
          {dateFilter && (
            <button
              onClick={onClearDateFilter}
              className="flex items-center gap-1.5 rounded-[6px] border border-border bg-muted px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Filtered to {dateFilter}
              <CloseIcon width={11} height={11} />
            </button>
          )}
        </div>

        {loading ? (
          <LoadingState className="py-10 text-center" />
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-[12px] text-faint">No backup versions{dateFilter ? ' on this day' : ' yet'}.</div>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {rows.map(({ run, upload }) => (
              <div key={`${run.id}-${upload.destinationId}`} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${upload.ok && !upload.deleted ? 'bg-primary' : 'bg-destructive'}`} />
                    <span className="font-medium">{fmtDate(run.startedAt)}</span>
                    <span className="text-faint">· {run.trigger}</span>
                    <span className="text-faint">· {storageNames[upload.destinationId] || 'storage'}</span>
                    {upload.encrypted && <ShieldIcon width={11} height={11} className="shrink-0 text-faint" />}
                  </div>
                  <div className="mt-1 text-[11px] text-faint">
                    {upload.deleted ? 'Deleted from storage' : upload.ok ? fmtBytes(upload.sizeBytes) : upload.error}
                    {/* The config JSON rides along with the dump; a failed one doesn't fail the run. */}
                    {upload.ok && !upload.deleted && upload.configKey && ' · + connection config'}
                    {upload.ok && !upload.deleted && upload.configError && (
                      <span className="text-destructive"> · config not saved: {upload.configError}</span>
                    )}
                  </div>
                </div>
                {upload.ok && !upload.deleted && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="link" size="inline" type="button" className="text-faint hover:text-foreground"
                          onClick={() =>
                            setRestoreTarget({ runId: run.id, destinationId: upload.destinationId, targetConnectionId: connectionId, confirming: false })
                          }
                          aria-label="Restore"
                        >
                          <RestoreIcon width={15} height={15} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Restore</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="link" size="inline" type="button" className="text-faint hover:text-foreground" onClick={() => doDownload(run.id, upload.destinationId)} aria-label="Download database">
                          <DownloadIcon width={15} height={15} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Download database</TooltipContent>
                    </Tooltip>
                    {upload.configKey && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="link" size="inline" type="button" className="text-faint hover:text-foreground"
                            onClick={() => doDownload(run.id, upload.destinationId, 'config')}
                            aria-label="Download connection config"
                          >
                            <SettingsIcon width={15} height={15} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Download connection config</TooltipContent>
                      </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="link" size="inline" type="button"
                          className="text-faint hover:text-foreground hover:!text-destructive"
                          onClick={() => setDeleteTarget({ runId: run.id, destinationId: upload.destinationId })}
                          aria-label="Delete"
                        >
                          <TrashIcon width={15} height={15} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Delete</TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            <Button variant="link" size="inline" type="button" className="text-faint hover:text-foreground" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft width={14} height={14} /> Prev
            </Button>
            <span className="text-[11px] text-faint">
              {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
            </span>
            <Button variant="link" size="inline" type="button" className="text-faint hover:text-foreground" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight width={14} height={14} />
            </Button>
          </div>
        )}
      </div>

      {restoreTarget && !restoreTarget.confirming && (
        <Dialog open onOpenChange={(open) => !open && (setRestoreTarget(null))}>
          <DialogContent showCloseButton={false} aria-describedby={undefined} className="block sm:max-w-[420px] p-5 gap-0">
            <DialogTitle className="text-sm font-bold text-foreground">Restore backup</DialogTitle>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">Choose which connection to overwrite with this backup.</p>
            <FormField label="Restore into" className="mt-4">
              <OptionSelect
              
                value={restoreTarget.targetConnectionId}
                options={sameTypeConnections.map((c) => ({ value: c.id, label: c.id === connectionId ? `${c.name} (this connection)` : c.name }))}
                onChange={(v) => setRestoreTarget((t) => (t ? { ...t, targetConnectionId: v } : t))}
              />
            </FormField>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRestoreTarget(null)}>
                Cancel
              </Button>
              <Button variant="default" size="sm" onClick={() => setRestoreTarget((t) => (t ? { ...t, confirming: true } : t))}>
                Continue
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {restoreTarget?.confirming && (
        <ConfirmDialog destructive
          title={`Restore into "${restoreTargetConn?.name || ''}"?`}
          description="This overwrites the target connection's live data with this backup. This can't be undone."
          typeToConfirm={restoreTargetConn?.name || ''}
          confirmLabel={busy ? 'Restoring…' : 'Restore'}
          onConfirm={doRestore}
          onCancel={() => !busy && setRestoreTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this backup version?"
          description="This permanently deletes the file from storage. This can't be undone."
          confirmLabel={busy ? 'Deleting…' : 'Delete'}
          cancelLabel="Cancel"
          destructive
          onConfirm={doDelete}
          onCancel={() => !busy && setDeleteTarget(null)}
        />
      )}
    </>
  )
}
