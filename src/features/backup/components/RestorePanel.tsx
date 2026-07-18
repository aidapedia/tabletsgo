import { useEffect, useRef, useState } from 'react'
import { useConnections } from '@/features/connections'
import Button from '@/shared/ui/buttons/Button'
import Select from '@/shared/ui/form/Select'
import SearchInput from '@/shared/ui/form/SearchInput'
import { controlClass } from '@/shared/ui/form/Input'
import { FormField } from '@/shared/ui/form/Form'
import TypeToConfirmDialog from '@/shared/ui/feedback/TypeToConfirmDialog'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CloudIcon, ShieldIcon, UploadIcon } from '@/shared/ui/icons'
import { listStorages, listStorageObjects, restoreFromStorageObject, restoreFromUpload } from '@/features/backup/lib/api'
import type { StorageDestination, StorageObject } from '@/features/backup/lib/types'

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

// What the user picked to restore from — decided before the type-to-confirm gate.
type Source = { kind: 'upload'; file: File } | { kind: 'storage'; destinationId: string; key: string }

// Restore this connection's live data from a source outside its own backup
// history: a backup file uploaded from disk, or any file picked out of a
// storage destination (S3 or the local server disk). Complements the run-based
// restore in BackupVersionList.
export default function RestorePanel({ connectionId, workspaceId }: { connectionId: string; workspaceId: string }) {
  const toast = useToast()
  const { connections } = useConnections() as { connections: any[] }
  const connectionName = connections.find((c) => c.id === connectionId)?.name || ''
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [browsing, setBrowsing] = useState(false)
  const [source, setSource] = useState<Source | null>(null)
  const [busy, setBusy] = useState(false)

  const pickFile = (file: File | null) => {
    if (file) setSource({ kind: 'upload', file })
  }

  const doRestore = async () => {
    if (!source) return
    setBusy(true)
    try {
      if (source.kind === 'upload') await restoreFromUpload(connectionId, source.file, connectionName)
      else await restoreFromStorageObject(connectionId, { destinationId: source.destinationId, key: source.key, confirmName: connectionName })
      toast.success(`Restored "${connectionName}".`)
      setSource(null)
      setBrowsing(false)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  const [dragging, setDragging] = useState(false)
  const sourceLabel = source?.kind === 'upload' ? source.file.name : source?.key.split('/').pop() || ''

  return (
    <>
      <div className="rounded-card border border-edge bg-card p-5">
        <div className="flex items-center gap-2 text-[13px] font-bold">
          <CloudIcon width={15} height={15} /> Restore from a file
        </div>

        {/* Drop zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            pickFile(e.dataTransfer.files?.[0] || null)
          }}
          className={`mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-soft border border-dashed px-4 py-7 text-center transition-colors ${
            dragging ? 'border-green bg-green-dim/40' : 'border-edge-strong hover:border-edge-strong hover:bg-elevated'
          }`}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-elevated text-ink-dim">
            <UploadIcon width={18} height={18} />
          </span>
          <div className="text-[12px] text-ink-dim">Drop your backup here</div>
          <div className="text-[11px] text-ink-faint">or</div>
          <span className="rounded-soft border border-edge bg-elevated px-3 py-1.5 text-[11px] font-semibold text-ink">Browse files</span>
        </div>

        <button
          onClick={() => setBrowsing(true)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-soft py-2 text-[11px] font-medium text-ink-dim transition-colors hover:bg-elevated hover:text-ink"
        >
          <CloudIcon width={13} height={13} /> Pick from a storage destination
        </button>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            pickFile(e.target.files?.[0] || null)
            e.target.value = '' // allow re-picking the same file
          }}
        />
      </div>

      {browsing && !source && (
        <StorageBrowserModal
          connectionId={connectionId}
          workspaceId={workspaceId}
          onPick={(destinationId, key) => setSource({ kind: 'storage', destinationId, key })}
          onClose={() => setBrowsing(false)}
        />
      )}

      {source && (
        <TypeToConfirmDialog
          title={`Restore "${connectionName}" from ${sourceLabel}?`}
          message="This overwrites the connection's live data with this file. This can't be undone."
          confirmText={connectionName}
          confirmLabel={busy ? 'Restoring…' : 'Restore'}
          onConfirm={doRestore}
          onCancel={() => !busy && setSource(null)}
        />
      )}
    </>
  )
}

// Destination picker + object list. Picking a file hands (destinationId, key)
// back to RestorePanel, which owns the confirm step.
function StorageBrowserModal({
  connectionId,
  workspaceId,
  onPick,
  onClose,
}: {
  connectionId: string
  workspaceId: string
  onPick: (destinationId: string, key: string) => void
  onClose: () => void
}) {
  const [storages, setStorages] = useState<StorageDestination[]>([])
  const [destinationId, setDestinationId] = useState('local')
  const [objects, setObjects] = useState<StorageObject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    listStorages(workspaceId).then(setStorages)
  }, [workspaceId])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    listStorageObjects(connectionId, destinationId)
      .then((objs) => alive && setObjects(objs))
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [connectionId, destinationId])

  const filtered = objects.filter((o) => o.key.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]" onMouseDown={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-[560px] animate-pop flex-col rounded-[16px] border border-edge-strong bg-panel p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-ink">Restore from storage</h3>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">Pick the backup file to restore this connection from.</p>
        <div className="mt-4 flex gap-3">
          <FormField label="Storage" className="w-1/2">
            <Select
              className={controlClass}
              value={destinationId}
              options={[{ value: 'local', label: 'Local server disk' }, ...storages.map((s) => ({ value: s.id, label: s.name }))]}
              onChange={setDestinationId}
            />
          </FormField>
          <FormField label="Search" className="flex-1">
            <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by name…" />
          </FormField>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-[10px] border border-edge">
          {loading ? (
            <LoadingState className="py-10 text-center" />
          ) : error ? (
            <div className="px-4 py-10 text-center text-[12px] text-red">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-ink-faint">{search ? 'No files match.' : 'No files in this storage.'}</div>
          ) : (
            <div className="flex flex-col divide-y divide-edge">
              {filtered.map((obj) => (
                <button
                  key={obj.key}
                  onClick={() => onPick(destinationId, obj.key)}
                  className="flex items-center justify-between gap-4 px-4 py-2.5 text-left hover:bg-elevated"
                >
                  <span className="flex min-w-0 items-center gap-2 text-[12px]">
                    <span className="truncate font-medium">{obj.key}</span>
                    {obj.key.endsWith('.enc') && <ShieldIcon width={11} height={11} className="shrink-0 text-ink-faint" />}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-faint">
                    {fmtBytes(obj.sizeBytes)}
                    {obj.lastModified ? ` · ${new Date(obj.lastModified).toLocaleString()}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="subtle" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
