import { useState } from 'react'
import { useWorkspaces, can, MembersPanel } from '@/features/workspaces'
import { PlusIcon } from '@/shared/ui/icons'
import { Section } from '@/shared/ui/page/Section'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { Button } from '@/shared/ui/button'

// Member section — its own sidebar row rather than a Workspace tab, because
// who belongs to the workspace is looked at far more often than the workspace's
// own settings. `/workspace/member` redirects here so old links still land.
export default function MembersPage() {
  const { current } = useWorkspaces()
  const canManage = can(current, 'members.manage')
  const [inviting, setInviting] = useState(false)

  return (
    <Section
      title="Member"
      desc="Invite teammates and manage who can access this workspace."
      action={
        canManage && (
          <Button variant="default" size="lg" onClick={() => setInviting(true)}>
            <PlusIcon width={15} height={15} />
            Invite member
          </Button>
        )
      }
    >
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
    </Section>
  )
}
