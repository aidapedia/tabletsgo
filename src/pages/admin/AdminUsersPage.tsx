import { useState } from 'react'
import { AdminUsersPanel } from '@/features/admin'
import Button from '@/shared/ui/buttons/Button'
import { PlusIcon } from '@/shared/ui/icons'
import { Section } from '@/pages/home/ui'

/**
 * `/admin/users` — every account on the instance.
 *
 * The sibling of the Workspaces section; the sidebar switches between the two.
 * This is where accounts are created and where the *system* role is set —
 * promoting someone to admin strips every workspace membership they hold.
 *
 * "New user" lives in the section header, like "New connection" on the
 * connections page; the panel below owns the list and the dialog itself.
 */
export default function AdminUsersPage() {
  const [creating, setCreating] = useState(false)

  return (
    <Section
      title="Users"
      desc="Accounts on this instance. An admin manages workspaces and accounts; everyone else gets their access from a workspace owner."
      action={
        <Button variant="primary" size="lg" icon={PlusIcon} onClick={() => setCreating(true)}>
          New user
        </Button>
      }
    >
      <AdminUsersPanel creating={creating} onCreatingChange={setCreating} />
    </Section>
  )
}
