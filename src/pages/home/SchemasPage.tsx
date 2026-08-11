import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWorkspaces } from '@/features/workspaces'
import { useConnections } from '@/features/connections'
import { NewSchemaDialog, WorkspaceSchemaList, type WorkspaceSchemaDraft } from '@/features/schema-designer'
import { createSchemaDraft } from '@/features/schema-designer/lib/api'
// Deep import, not the `@/features/workspace` barrel: that barrel re-exports the
// whole DB console (QueryEditor pulls CodeMirror in), and this page only wants
// the saved-query write a connection-linked draft is stored as.
import { createSaved } from '@/features/workspace/lib/savedQueries'
import Button from '@/shared/ui/buttons/Button'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { useToast } from '@/shared/ui/feedback/Toast'
import { PlusIcon } from '@/shared/ui/icons'
import { PageHeader } from './ui'

// Schema — every schema draft in the current workspace, across its connections
// plus the ones designed from scratch. The console has no diagram of its own:
// both kinds are designed on the editor page this list opens, which draws a
// connection draft from that live database and releases its DDL there. This
// section is the overview and where a new schema starts.
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
  // show the row, not the whole console.
  const open = (draft: WorkspaceSchemaDraft) => navigate(`/schemas/${draft.id}`)

  // "From a connection" is an empty draft *on* that connection: per-connection
  // drafts are that connection's saved queries (kind = 'schema'), so it is
  // written through the same route the editor page saves it back through. Both
  // kinds then open at the same address.
  const fromConnection = async (connectionId: string, name: string) => {
    try {
      const entry = await createSaved(connectionId, { name, sql: '', kind: 'schema', layout: null })
      setCreating(false)
      navigate(`/schemas/${entry.id}`)
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not create the schema')
    }
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
