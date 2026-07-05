import { useEffect, useState } from 'react'
import { useToast } from '@/shared/ui/feedback/Toast'
import TypeToConfirmDialog from '@/shared/ui/feedback/TypeToConfirmDialog'
import Button from '@/shared/ui/buttons/Button'
import { HistoryIcon } from '@/shared/ui/icons'
import { listBackupRuns, listStorages, restoreBackup } from '@/features/backup/lib/api'
import type { BackupRun, StorageDestination } from '@/features/backup/lib/types'

const fmtDate = (ts: number) => new Date(ts).toLocaleString()

// Recent backup runs, with a Restore action per successfully-uploaded
// destination. Restoring overwrites the connection's live data in place, so
// it's gated behind typing the connection's name to confirm.
export default function RestorePanel({ connectionId, connectionName, workspaceId }: { connectionId: string; connectionName: string; workspaceId: string }) {
  const toast = useToast()
  const [runs, setRuns] = useState<BackupRun[]>([])
  const [storageNames, setStorageNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [target, setTarget] = useState<{ runId: string; destinationId: string; label: string } | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([listBackupRuns(connectionId), listStorages(workspaceId)]).then(([rs, storages]) => {
      if (!alive) return
      setRuns(rs)
      setStorageNames(Object.fromEntries(storages.map((s: StorageDestination) => [s.id, s.name])))
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [connectionId, workspaceId])

  const doRestore = async () => {
    if (!target) return
    setRestoring(true)
    try {
      await restoreBackup(connectionId, { runId: target.runId, destinationId: target.destinationId, confirmName: connectionName })
      toast.success('Restore complete.')
      setTarget(null)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setRestoring(false)
    }
  }

  if (loading) return <div className="text-xs text-ink-faint">Loading…</div>
  if (!runs.length) return <div className="text-[12px] text-ink-faint">No backup runs yet.</div>

  return (
    <>
      <div className="rounded-card border border-edge bg-card">
        <div className="flex items-center gap-2 border-b border-edge px-5 py-3.5 text-[13px] font-bold">
          <HistoryIcon width={14} height={14} /> Recent runs
        </div>
        <div className="flex flex-col divide-y divide-edge">
          {runs.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[12px]">
                  <span className={`h-1.5 w-1.5 rounded-full ${r.status === 'success' ? 'bg-green' : 'bg-red'}`} />
                  <span className="font-medium">{fmtDate(r.startedAt)}</span>
                  <span className="text-ink-faint">· {r.trigger}</span>
                </div>
                {r.error && <div className="mt-1 truncate text-[11px] text-red">{r.error}</div>}
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                {r.uploads.map((u) =>
                  u.ok ? (
                    <Button
                      key={u.destinationId}
                      variant="ghost"
                      size="sm"
                      onClick={() => setTarget({ runId: r.id, destinationId: u.destinationId, label: storageNames[u.destinationId] || u.destinationId })}
                    >
                      Restore from {storageNames[u.destinationId] || 'storage'}
                    </Button>
                  ) : (
                    <span key={u.destinationId} className="text-[10px] text-ink-faint" title={u.error}>
                      {storageNames[u.destinationId] || 'storage'} failed
                    </span>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {target && (
        <TypeToConfirmDialog
          title={`Restore "${connectionName}"?`}
          message={`This overwrites the connection's live data with the backup from ${target.label}. This can't be undone.`}
          confirmText={connectionName}
          confirmLabel={restoring ? 'Restoring…' : 'Restore'}
          onConfirm={doRestore}
          onCancel={() => !restoring && setTarget(null)}
        />
      )}
    </>
  )
}
