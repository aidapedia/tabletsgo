import { useState } from 'react'
import { recordSchemaMigration, runQuery } from '@/shared/api/database'
import {
  buildDropTableRollback,
  rollbackForAddColumn,
  rollbackForCreateIndex,
  rollbackForCreateTable,
} from '@/features/schema-designer/lib/rollback'

const newChange = (c: any) => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  ts: Date.now(),
  ...c,
})

type Options = {
  connectionId: string
  nsConn: any
  queryTimeout: number
  directExecute: boolean
  toast: any
  patchLocalConnection: any
  /** Rows or tables changed underneath the open views — re-read them. */
  onDataChanged: () => void
  /** A batch bumped the schema version; refresh the trail if it is on screen. */
  onSchemaRecorded: () => void
}

/**
 * The staged-mutation queue behind the Changes panel.
 *
 * Every mutation the console makes — a row edit, an empty/drop, DDL from the
 * table editor — goes through `addChange`. With Direct execute on it runs at
 * once; otherwise it waits here until committed, newest first in the panel but
 * executed oldest first so the statements land in the order they were made.
 *
 * A batch stops at the first failure and keeps the rest staged for a retry, and
 * the DDL that *did* run is recorded as one schema-version bump — so a rollback
 * later undoes the commit, not each statement.
 */
export default function useStagedChanges({
  connectionId,
  nsConn,
  queryTimeout,
  directExecute,
  toast,
  patchLocalConnection,
  onDataChanged,
  onSchemaRecorded,
}: Options) {
  const [changes, setChanges] = useState<any[]>([]) // staged (uncommitted) SQL mutations
  const [changesOpen, setChangesOpen] = useState(false)
  const [committing, setCommitting] = useState(false)

  // Run a batch of changes (oldest first) against the DB. Stops at the first
  // failure, records any DDL that ran as one schema-version bump, refreshes the
  // views, and reports what happened.
  const runChangeBatch = async (ordered: any[]) => {
    const remaining: any[] = []
    const succeeded: any[] = []
    // Ran without error but matched no rows. Not a failure — but reporting it
    // as "committed" is how an edit that never landed (a row someone else
    // already changed, a stale WHERE) ends up looking like a success.
    const noop: any[] = []
    let failure: any = null
    for (const ch of ordered) {
      if (failure) {
        remaining.push(ch)
        continue
      }
      const res = await runQuery(nsConn, ch.sql, { timeoutMs: queryTimeout * 1000 })
      if (res?.error) {
        failure = res.error
        remaining.push(ch)
      } else {
        succeeded.push(ch)
        if ((ch.kind === 'update' || ch.kind === 'delete') && res?.rowCount === 0) noop.push(ch)
      }
    }
    onDataChanged()

    // One schema version bump per batch, covering only the DDL that actually
    // ran successfully in it — plain row edits never touch schemaVersion.
    const ddlSucceeded = succeeded.filter((ch) => ch.ddl)
    if (ddlSucceeded.length) {
      try {
        const { version } = await recordSchemaMigration(
          nsConn,
          ddlSucceeded.map((ch) => ({
            sql: ch.sql,
            rollbackSql: ch.rollbackSql ?? null,
            reversible: !!ch.reversible,
            label: ch.label,
          }))
        )
        patchLocalConnection(connectionId, { schemaVersion: version })
        onSchemaRecorded()
      } catch (e: any) {
        toast.error(`Couldn't record schema migration: ${e.message}`)
      }
    }

    return { succeeded, remaining, failure, noop }
  }

  // Direct-execute path: run one change immediately, no staging.
  const executeDirect = async (change: any) => {
    const { failure, noop } = await runChangeBatch([change])
    if (failure) toast.error(`${change.label} failed: ${failure}`)
    else if (noop.length) toast.info(`${change.label} matched no rows — nothing changed.`)
    else toast.success(`Executed: ${change.label}`)
  }

  // With Direct execute on, mutations skip the Changes panel and run right away;
  // otherwise they're staged for a later commit.
  const addChange = (c: any) => {
    if (directExecute) {
      executeDirect(newChange(c))
      return
    }
    setChanges((prev) => [newChange(c), ...prev])
  }

  // Execute every staged change in order (oldest first). Stop at the first
  // failure, keeping it (and the rest) in the list so they can be retried.
  const commitChanges = async () => {
    if (!changes.length || committing) return
    setCommitting(true)
    const { succeeded, remaining, failure, noop } = await runChangeBatch([...changes].reverse())
    setCommitting(false)
    setChanges(remaining.reverse())

    if (failure) {
      toast.error(`Committed ${succeeded.length}, then failed: ${failure}`)
    } else {
      toast.success(`Committed ${succeeded.length} change${succeeded.length > 1 ? 's' : ''}.`)
      if (noop.length) {
        toast.info(`${noop.length} of them matched no rows — those rows were not changed.`)
      }
      setChangesOpen(false)
    }
  }

  // Data deleted by DELETE FROM can't be reconstructed — not reversible.
  const emptyTable = (table: string) => {
    addChange({
      kind: 'delete',
      label: `Empty table ${table}`,
      sql: `DELETE FROM "${table}"`,
      table,
      ddl: true,
      reversible: false,
      rollbackSql: null,
    })
    if (!directExecute) toast.info(`Added empty-table to changes — commit to apply.`)
  }

  // Snapshot the table's columns before staging the drop so we can offer a
  // best-effort rollback (a CREATE TABLE that reconstructs it).
  const deleteTable = async (table: string) => {
    const { rollbackSql, reversible } = await buildDropTableRollback(nsConn, table)
    addChange({
      kind: 'delete',
      label: `Drop table ${table}`,
      sql: `DROP TABLE "${table}"`,
      table,
      ddl: true,
      reversible,
      rollbackSql,
    })
    if (!directExecute) toast.info(`Added drop-table to changes — commit to apply.`)
  }

  // Stage the table editor's statements, each with the rollback SQL its mode
  // implies. Sidebar "Create table" stages straight into Changes too.
  const stageTableChanges = (statements: string[], tableName: string, mode: string) => {
    statements.forEach((sql) => {
      // The same form also writes index DDL, which reverses on its own terms: a
      // CREATE is undone by a DROP, but rebuilding a *dropped* index needs the
      // definition read from the live schema — which this queue stages too
      // early to do — so that one is staged as non-reversible.
      const isIndex = /^\s*(CREATE\s+(UNIQUE\s+)?|DROP\s+)INDEX\b/i.test(sql)
      const rollbackSql = isIndex
        ? rollbackForCreateIndex(sql)
        : mode === 'edit'
          ? rollbackForAddColumn(sql, tableName)
          : rollbackForCreateTable(tableName)
      addChange({
        kind: mode === 'edit' ? 'update' : 'create',
        label: isIndex
          ? `Index on ${tableName}`
          : mode === 'edit'
            ? `Alter table ${tableName}`
            : `Create table ${tableName}`,
        sql,
        table: tableName,
        ddl: true,
        reversible: !!rollbackSql,
        rollbackSql,
      })
    })
  }

  return {
    changes,
    setChanges,
    changesOpen,
    setChangesOpen,
    committing,
    addChange,
    commitChanges,
    emptyTable,
    deleteTable,
    stageTableChanges,
  }
}
