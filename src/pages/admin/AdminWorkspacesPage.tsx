import { useState } from 'react'
import { AdminWorkspacesPanel } from '@/features/admin'
import Button from '@/shared/ui/buttons/Button'
import { PlusIcon } from '@/shared/ui/icons'
import { Section } from '@/pages/home/ui'

/**
 * `/admin` — every workspace on the instance and who runs it.
 *
 * One of the two instance-admin sections (Users is the other); the sidebar
 * switches between them, so neither page carries tabs of its own. An admin
 * holds no workspace membership, so there is nothing here below the level of
 * "which workspaces exist and who owns them".
 *
 * "New workspace" lives in the section header, like "New connection" on the
 * connections page; the panel below owns the list and the dialog itself.
 */
export default function AdminWorkspacesPage() {
  const [creating, setCreating] = useState(false)

  return (
    <Section
      title="Workspaces"
      desc="Every workspace on this instance. Admins don't join workspaces — assign an owner to run one."
      action={
        <Button variant="primary" size="lg" icon={PlusIcon} onClick={() => setCreating(true)}>
          New workspace
        </Button>
      }
    >
      <AdminWorkspacesPanel creating={creating} onCreatingChange={setCreating} />
    </Section>
  )
}
