import { AdminWorkspacesPanel } from '@/features/admin'
import { Section } from '@/pages/home/ui'

/**
 * `/admin` — every workspace on the instance and who runs it.
 *
 * One of the two instance-admin sections (Users is the other); the sidebar
 * switches between them, so neither page carries tabs of its own. An admin
 * holds no workspace membership, so there is nothing here below the level of
 * "which workspaces exist and who owns them".
 */
export default function AdminWorkspacesPage() {
  return (
    <Section
      title="Workspaces"
      desc="Every workspace on this instance. Admins don't join workspaces — assign an owner to run one."
    >
      <AdminWorkspacesPanel />
    </Section>
  )
}
