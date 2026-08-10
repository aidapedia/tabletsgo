import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWorkspaces } from '@/features/workspaces'
import { useConnections } from '@/features/connections'
import { NewSchemaDialog, WorkspaceSchemaList, type WorkspaceSchemaDraft } from '@/features/schema-designer'
import { createSchemaDraft } from '@/features/schema-designer/lib/api'
import Button from '@/shared/ui/buttons/Button'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { useToast } from '@/shared/ui/feedback/Toast'
import { PlusIcon } from '@/shared/ui/icons'
import { PageHeader } from './ui'

// Schema — every schema draft in the current workspace, across its connections
// plus the ones designed from scratch. Designing against a live database belongs
// to the console (that is where the diagram and its DDL run); this section is
// the overview the console can't give, and where a new schema starts.
export default function SchemasPage() {
  const { current } = useWorkspaces()
  const { connections } = useConnections()
  const navigate = useNavigate()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  // Bumped after a create so the list refetches without a full remount.
  const [reloadKey, setReloadKey] = useState(0)

  // Every draft opens in the schema editor page, whichever kind it is — the
  // designer needs connection *access*, which this list already required to
  // show the row, not the whole console. A connection-linked draft still gets
  // there in one click (the editor page carries an "Open in console" link),
  // because running its DDL is the console's Changes queue.
  const open = (draft: WorkspaceSchemaDraft) => navigate(`/schemas/${draft.id}`)

  // "From a connection" creates nothing here — the console owns that tab, so
  // this only asks it for a fresh schema editor on that connection.
  const fromConnection = (connectionId: string) => {
    setCreating(false)
    navigate(`/connection/${connectionId}?schema=new`)
  }

  const fromScratch = async (fields: { name: string; dbType: string }) => {
    if (!current) return
    try {
      const draft = await createSchemaDraft(current.id, fields)
      setCreating(false)
      setReloadKey((k) => k + 1)
      navigate(`/schemas/${draft.id}`)
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not create the schema')
    }
  }

  return (
    <div className="w-full">
      <PageHeader
        title="Schema Editor"
        desc="Every schema draft in this workspace — which database it targets, and how much is staged."
        action={
          <Button variant="primary" size="sm" icon={PlusIcon} onClick={() => setCreating(true)} disabled={!current}>
            New schema
          </Button>
        }
      />

      <div className="mt-6">
        {current ? (
          <WorkspaceSchemaList key={reloadKey} workspaceId={current.id} onOpen={open} />
        ) : (
          <LoadingState className="" />
        )}
      </div>

      {creating && (
        <NewSchemaDialog
          connections={connections}
          onClose={() => setCreating(false)}
          onFromConnection={fromConnection}
          onFromScratch={fromScratch}
        />
      )}
    </div>
  )
}
