import { useRef } from 'react'
import { useWorkspaces, can } from '@/features/workspaces'
import { SshKeyList, type SshListHandle } from '@/features/ssh'
import { PlusIcon } from '@/shared/ui/icons'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { Section } from '@/shared/ui/page/Section'
import { Button } from '@/shared/ui/button'

// SSH → Key: the keypairs used to log in to SSH hosts. Anyone in the workspace
// may copy a public key; creating and deleting one is `ssh.manage`.
export default function SshKeysPage() {
  const { current } = useWorkspaces()
  const canManage = can(current, 'ssh.manage')
  const listRef = useRef<SshListHandle>(null)

  return (
    <Section
      title="Keys"
      desc="Keys for logging in to your SSH hosts. Generate one here or import an existing private key, then add its public key to the host's authorized_keys."
      action={
        canManage && (
          <Button variant="default" size="lg" onClick={() => listRef.current?.openCreate()}>
            <PlusIcon width={15} height={15} />
            New key
          </Button>
        )
      }
    >
      {current ? <SshKeyList ref={listRef} workspaceId={current.id} canManage={canManage} /> : <LoadingState className="" />}
    </Section>
  )
}
