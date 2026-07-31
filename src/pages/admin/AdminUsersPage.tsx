import { AdminUsersPanel } from '@/features/admin'
import { Section } from '@/pages/home/ui'

/**
 * `/admin/users` — every account on the instance.
 *
 * The sibling of the Workspaces section; the sidebar switches between the two.
 * This is where accounts are created and where the *system* role is set —
 * promoting someone to admin strips every workspace membership they hold.
 */
export default function AdminUsersPage() {
  return (
    <Section
      title="Users"
      desc="Accounts on this instance. An admin manages workspaces and accounts; everyone else gets their access from a workspace owner."
    >
      <AdminUsersPanel />
    </Section>
  )
}
