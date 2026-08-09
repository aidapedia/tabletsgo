import { useState } from 'react'
import { useWorkspaces, can, MembersPanel } from '@/features/workspaces'
import Button from '@/shared/ui/buttons/Button'
import { PlusIcon } from '@/shared/ui/icons'
import { PageHeader } from './ui'
import LoadingState from '@/shared/ui/feedback/LoadingState'

// Member section — its own sidebar row rather than a Workspace tab, because
// who belongs to the workspace is looked at far more often than the workspace's
// own settings. `/workspace/member` redirects here so old links still land.
//
// The roster is a full-width DataTable, so the page uses PageHeader directly
// (not `Section`) to put "Invite member" beside the title, as the connections
// and storage lists do.
export default function MembersPage() {
  const { current } = useWorkspaces()
  const canManage = can(current, 'members.manage')
  const [inviting, setInviting] = useState(false)

  return (
    <div className="w-full">
      <PageHeader
        title="Member"
        desc="Invite teammates and manage who can access this workspace."
        action={
          canManage && (
            <Button variant="primary" size="lg" icon={PlusIcon} onClick={() => setInviting(true)}>
              Invite member
            </Button>
          )
        }
      />

      <div className="mt-6">
        {current ? (
          <MembersPanel
            workspaceId={current.id}
            canManage={canManage}
            inviting={inviting}
            onInvitingChange={setInviting}
          />
        ) : (
          <LoadingState className="" />
        )}
      </div>
    </div>
  )
}
