import { useEffect, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import Checkbox from '@/shared/ui/form/Checkbox'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CloseIcon, DownloadIcon } from '@/shared/ui/icons'
import { exportConnection, downloadConnectionExport } from '../api'
import type { ConnectionExport } from '../api'

// What the bundle contains, in the order it reads best. `count` walks the doc
// so this list stays a pure view of whatever the server put in it.
const CONTENTS: { label: string; count: (d: ConnectionExport) => number }[] = [
  { label: 'Connection settings', count: () => 1 },
  { label: 'Folders', count: (d) => d.folders.length },
  { label: 'Grouped tables', count: (d) => d.tableFolders.length },
  { label: 'Saved queries', count: (d) => d.savedQueries.length },
  { label: 'Workflows', count: (d) => d.workflows.length },
  { label: 'Dashboards', count: (d) => d.dashboards.length },
  { label: 'Backup schedule', count: (d) => (d.backupSchedule ? 1 : 0) },
]

// "Export connection" modal: previews what the bundle holds, then downloads it
// as `<name>.connection.json`. The stored password is left out unless asked for
// — the file usually leaves this instance.
export default function ConnectionExportModal({ conn, onClose }: { conn: any; onClose: () => void }) {
  const toast = useToast()
  const [doc, setDoc] = useState<ConnectionExport | null>(null)
  const [error, setError] = useState('')
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [busy, setBusy] = useState(false)
  const isSqlite = conn.type === 'sqlite'

  useEffect(() => {
    let alive = true
    exportConnection(conn.id)
      .then((d) => alive && setDoc(d))
      .catch((e: any) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [conn.id])

  const download = async () => {
    if (!doc || busy) return
    setBusy(true)
    try {
      downloadConnectionExport(includeSecrets ? await exportConnection(conn.id, true) : doc)
      toast.success(`Exported "${conn.name}".`)
      onClose()
    } catch (e: any) {
      toast.error(`Export failed: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-[460px] animate-pop rounded-[16px] border border-edge-strong bg-panel p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <h2 className="text-[18px] font-bold">Export connection</h2>
            <p className="mt-1 truncate text-[13px] text-ink-dim">Everything configured for “{conn.name}”, as one JSON file.</p>
          </div>
          <IconButton size="lg" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </IconButton>
        </div>

        {error ? (
          <p className="mt-5 text-[12px] text-red">{error}</p>
        ) : !doc ? (
          <LoadingState className="py-10 text-center" />
        ) : (
          <>
            <div className="mt-5 rounded-card border border-edge bg-card p-1">
              {CONTENTS.map(({ label, count }) => (
                <div key={label} className="flex items-center justify-between px-3 py-2 text-[12px]">
                  <span className="text-ink-dim">{label}</span>
                  <span className="font-mono font-semibold">{count(doc)}</span>
                </div>
              ))}
            </div>

            {!isSqlite && (
              <label className="mt-4 flex cursor-pointer items-start gap-2.5">
                <Checkbox checked={includeSecrets} onChange={setIncludeSecrets} ariaLabel="Include password" className="mt-px" />
                <span className="text-[12px]">
                  Include the password
                  <span className="mt-0.5 block text-[11px] text-ink-faint">
                    Leave this off to share the file — the importer types the password instead.
                  </span>
                </span>
              </label>
            )}

            <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
              Run history, schema versions and access grants stay behind — they describe this instance, not the connection.
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <Button size="lg" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" size="lg" icon={DownloadIcon} disabled={busy} onClick={download}>
                {busy ? 'Preparing…' : 'Download JSON'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
