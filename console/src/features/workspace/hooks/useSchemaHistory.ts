import { useState } from 'react'
import { listSchemaMigrations, rollbackSchema } from '@/shared/api/database'

/**
 * The connection's migration audit trail, plus the rollback it offers.
 *
 * Rolling back to a version is the server's job: it runs the down SQL for every
 * active version newer than the target, marks them rolled back, and *resets*
 * the connection's schema version to the target rather than bumping past it.
 * `onRolledBack` lets the console refresh whatever was drawn from the old
 * schema.
 */
export default function useSchemaHistory(
  connectionId: string,
  nsConn: any,
  { toast, patchLocalConnection, onRolledBack }: { toast: any; patchLocalConnection: any; onRolledBack?: () => void }
) {
  const [schemaMigrations, setSchemaMigrations] = useState<any[]>([])
  const [schemaHistoryLoading, setSchemaHistoryLoading] = useState(false)
  const [rollbackTarget, setRollbackTarget] = useState<any>(null) // migration awaiting confirmation
  const [rollingBack, setRollingBack] = useState(false)

  const loadSchemaHistory = async () => {
    setSchemaHistoryLoading(true)
    try {
      setSchemaMigrations(await listSchemaMigrations(nsConn))
    } finally {
      setSchemaHistoryLoading(false)
    }
  }

  const rollbackMigration = async (m: any) => {
    setRollingBack(true)
    try {
      const { version } = await rollbackSchema(nsConn, m.version)
      patchLocalConnection(connectionId, { schemaVersion: version })
      toast.success(`Rolled back to v${version}.`)
      onRolledBack?.()
      loadSchemaHistory()
    } catch (e: any) {
      toast.error(`Rollback failed: ${e.message}`)
    }
    setRollingBack(false)
    setRollbackTarget(null)
  }

  return {
    schemaMigrations,
    schemaHistoryLoading,
    rollbackTarget,
    setRollbackTarget,
    rollingBack,
    loadSchemaHistory,
    rollbackMigration,
  }
}
