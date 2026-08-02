import { AdminRolesPanel } from '@/features/admin'
import { Narrow, Section } from '@/pages/home/ui'

/**
 * `/admin/roles` — the workspace access model for the whole instance.
 *
 * An admin defines what each role may do; a workspace owner decides who holds
 * it. The account's *system* role (admin vs user) isn't editable here on
 * purpose: instance administration deliberately carries no workspace data
 * access, so making it configurable would only be a way around that.
 */
export default function AdminRolesPage() {
  return (
    <Section
      title="Roles"
      desc="What each workspace role may do. Workspace owners assign their members to these; the permissions themselves are set here."
    >
      <Narrow>
        <AdminRolesPanel />
      </Narrow>
    </Section>
  )
}
