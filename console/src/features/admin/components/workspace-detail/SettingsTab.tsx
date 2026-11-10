import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { TrashIcon } from '@/shared/ui/icons'
import Narrow from '@/shared/ui/page/Narrow'
import { deleteWorkspaceAs, renameWorkspaceAs, type AdminWorkspaceOverview } from '../../api'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form/FormField'
import { Input } from '@/shared/ui/input'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

const SECTION = 'rounded-xl border bg-card p-5'
const HEADING = 'text-[16px] font-bold tracking-[-0.2px]'

export default function SettingsTab({
  overview,
  onChanged,
  onDeleted,
}: {
  overview: AdminWorkspaceOverview
  onChanged: () => void
  onDeleted: () => void
}) {
  const { workspace, counts } = overview
  const [name, setName] = useState(workspace.name)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => setName(workspace.name), [workspace.name])

  const trimmed = name.trim()
  const unchanged = !trimmed || trimmed === workspace.name

  const rename = async () => {
    if (unchanged) return
    try {
      await renameWorkspaceAs(workspace.id, trimmed)
      toast.success('Workspace renamed.')
      onChanged()
    } catch (err) {
      toast.error(err.message)
      setName(workspace.name)
    }
  }

  const confirmDelete = async () => {
    setDeleting(false)
    try {
      const { connectionsDeleted } = await deleteWorkspaceAs(workspace.id)
      toast.success(`Deleted “${workspace.name}” and ${connectionsDeleted} connection${connectionsDeleted === 1 ? '' : 's'}.`)
      onDeleted()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const lost = [
    ['Connections', counts.connections],
    ['Dashboards', counts.dashboards],
    ['Workflows', counts.workflows],
    ['Saved queries', counts.savedQueries],
    ['Schema drafts', counts.schemaDrafts],
    ['Groups', counts.groups],
    ['Storage destinations', counts.storageDestinations],
    ['SSH hosts and keys', counts.sshHosts + counts.sshKeys],
  ] as const

  return (
    <Narrow width={680} className="flex flex-col gap-5">
      <section className={`${SECTION} border-border`}>
        <h2 className={`${HEADING} mb-4`}>General</h2>
        <FormField label="Workspace name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <Button variant="default" disabled={unchanged} onClick={rename}>
          Save name
        </Button>
      </section>

      <section className={`${SECTION} border-border`}>
        <h2 className={HEADING}>Set by the workspace</h2>
        <p className="mb-4 mt-1 text-[12px] text-muted-foreground">The owners manage these from their own settings. They’re shown here for reference.</p>
        <dl className="flex flex-col gap-3 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Sessions per connection</dt>
            <dd>{workspace.maxSessionsPerConnection || 'Not set'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Backup failure alerts</dt>
            <dd>{workspace.backupFailureAlerts ? 'On' : 'Off'}</dd>
          </div>
        </dl>
      </section>

      <section className={`${SECTION} border-destructive/30`}>
        <h2 className={HEADING}>Delete this workspace</h2>
        <p className="mb-3.5 mt-1 text-[12px] text-muted-foreground">
          This can’t be undone. The databases themselves aren’t touched, but Tabletsgo loses everything it stores about them:
        </p>
        <ul className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(min(190px,100%),1fr))] gap-x-4 gap-y-1.5 text-[13px]">
          {lost.map(([label, count]) => (
            <li key={label} className="flex justify-between gap-3">
              <span className="text-muted-foreground">{label}</span>
              <span className="tabular-nums">{count}</span>
            </li>
          ))}
        </ul>
        <Button variant="destructive" onClick={() => setDeleting(true)}>
          <TrashIcon width={15} height={15} />
          Delete workspace
        </Button>
      </section>

      {deleting && (
        <ConfirmDialog destructive
          title="Delete workspace?"
          description={`This permanently deletes “${workspace.name}” and everything listed on this page. Type the workspace name to confirm.`}
          typeToConfirm={workspace.name}
          confirmLabel="Delete workspace"
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(false)}
        />
      )}
    </Narrow>
  )
}
