import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AdminWorkspacesPanel } from '@/features/admin'
import Button from '@/shared/ui/buttons/Button'
import { PlusIcon } from '@/shared/ui/icons'
import { Section } from '@/pages/home/ui'

/**
 * `/admin` — every workspace on the instance and who runs it.
 *
 * One of the two instance-admin sections (Users is the other); the sidebar
 * switches between them, so neither page carries tabs of its own. A row opens
 * that workspace's detail page.
 *
 * "New workspace" lives in the section header, like "New connection" on the
 * connections page; the panel below owns the list and the dialog itself.
 */
export default function AdminWorkspacesPage() {
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

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
      <AdminWorkspacesPanel creating={creating} onCreatingChange={setCreating} onOpen={(id) => navigate(`/admin/workspaces/${id}`)} />
    </Section>
  )
}
