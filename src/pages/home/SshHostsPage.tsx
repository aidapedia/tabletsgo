import { useRef } from 'react'
import { useWorkspaces, can } from '@/features/workspaces'
import { SshGatewayList, type SshListHandle } from '@/features/ssh'
import Button from '@/shared/ui/buttons/Button'
import { PlusIcon } from '@/shared/ui/icons'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { Section } from './ui'

// SSH → Host: the SSH hosts (bastions; `gateways` in the API) a connection
// tunnels through.
export default function SshHostsPage() {
  const { current } = useWorkspaces()
  // A gateway holds credentials into the workspace's private network.
  const canManage = can(current, 'ssh.manage')
  const listRef = useRef<SshListHandle>(null)

  return (
    <Section
      title="Hosts"
      desc="SSH hosts (bastions) that connections tunnel through to reach databases on a private network."
      action={
        canManage && (
          <Button variant="primary" size="lg" icon={PlusIcon} onClick={() => listRef.current?.openCreate()}>
            New host
          </Button>
        )
      }
    >
      {current ? <SshGatewayList ref={listRef} workspaceId={current.id} canManage={canManage} /> : <LoadingState className="" />}
    </Section>
  )
}
