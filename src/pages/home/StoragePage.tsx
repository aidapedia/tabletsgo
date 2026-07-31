import { useRef } from 'react'
import { useWorkspaces } from '@/features/workspaces'
import { StorageList, type StorageListHandle } from '@/features/backup'
import Button from '@/shared/ui/buttons/Button'
import { PlusIcon } from '@/shared/ui/icons'
import { PageHeader } from './ui'
import LoadingState from '@/shared/ui/feedback/LoadingState'

// S3 Storage — workspace-scoped storage destinations connections back up to.
export default function StoragePage() {
  const { current } = useWorkspaces()
  // A destination holds write credentials for somewhere the workspace's data
  // lands, so creating one is owner-level — same bar as a connection.
  const isOwner = current?.role === 'owner'
  const listRef = useRef<StorageListHandle>(null)

  return (
    <div className="w-full">
      <PageHeader
        title="S3 Storage"
        desc="S3-compatible storage destinations (AWS S3, MinIO, R2, B2, …) that connections can back up to."
        action={
          isOwner && (
            <Button variant="primary" size="lg" icon={PlusIcon} onClick={() => listRef.current?.openCreate()}>
              New destination
            </Button>
          )
        }
      />

      <div className="mt-6">
        {current ? <StorageList ref={listRef} workspaceId={current.id} canManage={isOwner} /> : <LoadingState className="" />}
      </div>
    </div>
  )
}
