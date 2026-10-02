import { useState } from 'react'
import { useWorkspaces, can, MembersPanel } from '@/features/workspaces'
import Button from '@/shared/ui/buttons/Button'
import { PlusIcon } from '@/shared/ui/icons'
import { Section } from './ui'
import LoadingState from '@/shared/ui/feedback/LoadingState'

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
          <Button variant="primary" size="lg" icon={PlusIcon} onClick={() => setInviting(true)}>
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
