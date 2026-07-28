import { useState } from 'react'
import { useConnections } from '../stores/ConnectionsContext'
import { TYPE_LABEL } from './DbTypePickerModal'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import { Input } from '@/shared/ui/form/Input'
import { FormField } from '@/shared/ui/form/Form'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CloseIcon, DbLogo, UploadIcon } from '@/shared/ui/icons'
import type { ConnectionExport } from '../api'

// Artifact counts shown as a summary — zero rows are dropped so the list stays short.
const summary = (doc: ConnectionExport) =>
  [
    ['folder', doc.folders.length],
    ['grouped table', doc.tableFolders.length],
    ['saved query', doc.savedQueries.length],
    ['workflow', doc.workflows.length],
    ['dashboard', doc.dashboards.length],
    ['backup schedule', doc.backupSchedule ? 1 : 0],
  ]
    .filter(([, n]) => (n as number) > 0)
    .map(([label, n]) => `${n} ${label}${(n as number) === 1 ? '' : 's'}`)

// "Import connection" modal: confirms the name, collects whatever credential the
// file left out (a password, or SQLite's file path on this host), then creates
// the connection with everything the bundle carried.
export default function ConnectionImportModal({
  doc,
  onClose,
  onImported,
}: {
  doc: ConnectionExport
  onClose: () => void
  onImported: (conn: any) => void
}) {
  const toast = useToast()
  const { importConnection } = useConnections()
  const isSqlite = doc.connection.type === 'sqlite'
  const [name, setName] = useState(doc.connection.name || '')
  const [password, setPassword] = useState('')
  const [filepath, setFilepath] = useState(doc.connection.settings?.filepath || '')
  const [busy, setBusy] = useState(false)

  const contents = summary(doc)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const settings = isSqlite ? { filepath: filepath.trim() } : password ? { password } : undefined
      const result = await importConnection({ document: doc, name: name.trim(), settings })
      toast.success(`Imported "${result.connection.name}".`)
      result.warnings.forEach((w: string) => toast.info(w, { duration: 8000 }))
      onImported(result.connection)
    } catch (err: any) {
      toast.error(`Import failed: ${err.message}`)
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]"
      onMouseDown={onClose}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-[460px] animate-pop rounded-[16px] border border-edge-strong bg-panel p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <h2 className="text-[18px] font-bold">Import connection</h2>
            <p className="mt-1 text-[13px] text-ink-dim">A new connection is created in this workspace.</p>
          </div>
          <IconButton size="lg" onClick={onClose} aria-label="Close" type="button">
            <CloseIcon />
          </IconButton>
        </div>

        {/* What the file holds */}
        <div className="mt-5 flex items-start gap-3 rounded-card border border-edge bg-card p-4">
          <DbLogo type={doc.connection.type} className="h-10 w-10 shrink-0 rounded-[11px]" />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">{doc.connection.name}</div>
            <div className="mt-0.5 text-[11px] text-ink-dim">
              {TYPE_LABEL[doc.connection.type] || doc.connection.type}
              {doc.connection.environment ? ` · ${doc.connection.environment}` : ''}
            </div>
            <div className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              {contents.length ? contents.join(' · ') : 'Connection settings only.'}
            </div>
          </div>
        </div>

        <FormField label="Name" className="mt-4">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Connection name" autoFocus />
        </FormField>

        {isSqlite ? (
          <FormField label="Database file path" className="mt-4" hint="The path on this server — it may differ from where the file was exported.">
            <Input value={filepath} onChange={(e) => setFilepath(e.target.value)} placeholder="/data/app.db" />
          </FormField>
        ) : (
          !doc.includesSecrets && (
            <FormField label="Password" className="mt-4" hint="This export was taken without the password. Leave blank to fill it in later.">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </FormField>
          )
        )}

        <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
          Scheduled workflows and backups arrive paused, and webhook triggers get fresh tokens.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <Button size="lg" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="lg" type="submit" icon={UploadIcon} disabled={!name.trim() || busy}>
            {busy ? 'Importing…' : 'Import'}
          </Button>
        </div>
      </form>
    </div>
  )
}
