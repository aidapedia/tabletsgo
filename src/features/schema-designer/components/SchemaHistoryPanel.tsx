import { useEffect, useMemo, useState } from 'react'
import { listSchemaMigrations, rollbackSchema } from '@/shared/api/database'
import Avatar from '@/shared/ui/Avatar'
import Badge from '@/shared/ui/Badge'
import Button from '@/shared/ui/buttons/Button'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import { useToast } from '@/shared/ui/feedback/Toast'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import { RowAction, RowActions } from '@/shared/ui/table/RowActions'
import useDataTable from '@/shared/ui/table/useDataTable'
import { EyeIcon, RefreshIcon, RestoreIcon } from '@/shared/ui/icons'
import MigrationInspector, { canRollbackTo, fmtTime, rollbackTitle } from './MigrationInspector'

// The dialect the read-only SQL panes highlight in. Same three-line map the
// console and DashboardView keep — it is the driver registry's engine id spelt
// the way CodeMirror's SQL grammar names it, not a label anyone reads.
const DIALECT = { postgresql: 'PostgreSQL', sqlite: 'SQLite', redis: 'Redis' }

type Migration = {
  id: string
  version: number
  status?: string
  reversible: boolean
  forwardSql: string[]
  rollbackSql: string[]
  executorName?: string | null
  ts?: number
}

// One row of the table: a committed migration, or the synthetic baseline below
// the earliest one. `canRollback` is decided once here so the button, its
// disabled explanation and the inspector's own button all read the same rule.
type Row = { id: string; migration: Migration; isBaseline: boolean; canRollback: boolean }

/**
 * A connection's schema version history, on its detail page.
 *
 * The same trail the console shows, asked as a question *about the connection*
 * rather than from inside a session on it: what DDL has been committed here, by
 * whom, and how far back can it be undone. That question belongs beside Access
 * and Backup — the other things you check about a database without opening it —
 * and answering it here is what lets a schema draft's row link straight to the
 * history of the database it targets, instead of routing someone through the
 * console to read it.
 *
 * It is deliberately *not* SchemaHistoryView. That view is the console's: a full
 * DataGrid with filter/sort/columns/CSV and a flex-height body the console's
 * pane gives it, none of which a padded home tab has or wants. What the two do
 * share is the part that must not drift — `canRollbackTo`, `rollbackTitle` and
 * the MigrationInspector slide-over all come from MigrationInspector, so the
 * rule for "can this version be a rollback target" is written once.
 *
 * Rollback runs real DDL, so it asks first, in the same words the console asks
 * in. Afterwards `onChange` lets the host re-read the connection: its schema
 * version is on the page behind this tab.
 */
export default function SchemaHistoryPanel({
  conn,
  onChange,
}: {
  conn: { id: string; type: string; name?: string }
  /** Called after a rollback — the connection's schemaVersion just moved. */
  onChange?: () => void
}) {
  const toast = useToast()
  const [migrations, setMigrations] = useState<Migration[]>([])
  const [loading, setLoading] = useState(true)
  const [inspecting, setInspecting] = useState<Row | null>(null)
  const [rollbackTarget, setRollbackTarget] = useState<Row | null>(null)
  const [rollingBack, setRollingBack] = useState(false)

  // One fetch site, re-run by bumping `reloadKey` — the Refresh button and the
  // read after a rollback are the same read, and going through the effect is
  // what keeps the `alive` guard on both (switching connections mid-request
  // would otherwise let the old answer land on the new page).
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((k) => k + 1)

  useEffect(() => {
    let alive = true
    setLoading(true)
    listSchemaMigrations(conn).then((list) => {
      if (!alive) return
      setMigrations(list as Migration[])
      setLoading(false)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.id, reloadKey])

  // Newest first — a version trail is read from the top, and the newest is both
  // the current schema and the one most likely being asked about.
  const rows = useMemo<Row[]>(() => {
    const list = [...migrations].sort((a, b) => b.version - a.version)
    const out: Row[] = list.map((m) => ({
      id: m.id,
      migration: m,
      isBaseline: false,
      canRollback: canRollbackTo(migrations, m),
    }))
    // The synthetic baseline: the state before the earliest active migration.
    // A fresh connection records nothing for it, so without this row the very
    // first commit could never be undone. It only means anything while
    // something is active, and only reachable when all of it is reversible.
    const active = migrations.filter((m) => (m.status || 'active') === 'active')
    if (active.length > 0) {
      const version = Math.min(...active.map((a) => a.version)) - 1
      out.push({
        id: '__baseline__',
        migration: { id: '__baseline__', version, status: 'active', reversible: true, forwardSql: [], rollbackSql: [] },
        isBaseline: true,
        canRollback: active.every((a) => a.reversible),
      })
    }
    return out
  }, [migrations])

  /**
   * Undo every active version newer than the target.
   *
   * The server does the whole walk in one call — runs each down SQL, marks
   * those versions rolled back and resets the connection's schema version — so
   * there is one request here and no partial state to reconcile locally. The
   * list is re-read afterwards rather than patched: what came back is the
   * server's account of which versions are still active.
   */
  const confirmRollback = async () => {
    const target = rollbackTarget
    if (!target || rollingBack) return
    setRollingBack(true)
    try {
      const { version } = await rollbackSchema(conn, target.migration.version)
      setRollbackTarget(null)
      toast.success(`Rolled back to v${version}.`)
      reload()
      onChange?.()
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not roll the schema back')
    } finally {
      setRollingBack(false)
    }
  }

  const columns: Column<Row>[] = [
    {
      key: 'version',
      header: 'Version',
      width: 150,
      render: (row) => (
        <span className="flex items-center gap-2">
          <span className="font-mono text-[12px] font-medium text-ink">v{row.migration.version}</span>
          {row.isBaseline ? (
            <Badge tone="faint">Initial</Badge>
          ) : (row.migration.status || 'active') === 'rollbacked' ? (
            <Badge tone="faint">Rolled back</Badge>
          ) : (
            <Badge tone="green">Active</Badge>
          )}
        </span>
      ),
    },
    {
      key: 'statements',
      header: 'Changes',
      width: 140,
      // What the commit ran. The baseline ran nothing — it is the state before
      // the first migration, not a migration — so it says so rather than "0".
      render: (row) =>
        row.isBaseline ? (
          <span className="text-[11px] text-ink-faint">Before the first migration</span>
        ) : (
          <Badge tone="neutral">
            {row.migration.forwardSql.length} statement{row.migration.forwardSql.length === 1 ? '' : 's'}
          </Badge>
        ),
    },
    {
      key: 'reversible',
      header: 'Reversible',
      width: 130,
      // Whether down SQL was recorded — which is what decides how far back the
      // trail can be walked, so it is a column rather than a detail.
      render: (row) =>
        row.isBaseline ? (
          <span className="text-[11px] text-ink-faint">—</span>
        ) : row.migration.reversible ? (
          <Badge tone="neutral">Yes</Badge>
        ) : (
          <Badge tone="amber">No</Badge>
        ),
    },
    {
      key: 'executor',
      header: 'Committed by',
      width: 190,
      className: 'max-[900px]:hidden',
      render: (row) =>
        row.isBaseline ? (
          <span className="text-[11px] text-ink-faint">—</span>
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            {row.migration.executorName ? (
              <Avatar label={row.migration.executorName} size="sm" />
            ) : (
              <span className="h-6 w-6 shrink-0 rounded-full bg-elevated" />
            )}
            <span
              className={`min-w-0 truncate text-[11px] ${
                row.migration.executorName ? 'text-ink-dim' : 'italic text-ink-faint'
              }`}
            >
              {row.migration.executorName || 'Unknown'}
            </span>
          </span>
        ),
    },
    {
      key: 'ts',
      header: 'Committed at',
      render: (row) => (
        <span className="text-[11px] text-ink-dim">{row.isBaseline ? '—' : fmtTime(row.migration.ts)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 100,
      align: 'right' as const,
      render: (row) => (
        <RowActions>
          <RowAction
            icon={EyeIcon}
            label="Show the SQL"
            aria={`Show the SQL of v${row.migration.version}`}
            disabled={row.isBaseline}
            disabledHint="The initial state has no SQL — it is what was there before the first migration"
            onClick={() => setInspecting(row)}
          />
          <RowAction
            icon={RestoreIcon}
            label={`Roll back to v${row.migration.version}`}
            aria={`Roll the schema back to v${row.migration.version}`}
            disabled={!row.canRollback}
            // The same sentence the console's row menu and the inspector's
            // button give, so the reason a version is not a target reads
            // identically wherever it is refused.
            disabledHint={rollbackTitle({
              __isBaseline: row.isBaseline,
              __canRollback: row.canRollback,
              __migration: row.migration,
            })}
            onClick={() => setRollbackTarget(row)}
          />
        </RowActions>
      ),
    },
  ]

  const table = useDataTable({ rows, columns, pageSize: 10 })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-ink-dim">
          Every DDL commit against this database, newest first — released from the schema editor or run in the console.
        </p>
        <Button variant="subtle" size="sm" icon={RefreshIcon} onClick={reload} disabled={loading}>
          Refresh
        </Button>
      </div>

      <DataTable
        columns={columns}
        rowKey={(row) => row.id}
        onRowClick={(row) => !row.isBaseline && setInspecting(row)}
        loading={loading}
        empty={
          <EmptyState>
            No schema versions yet — nothing has been committed to this database through Tabletsgo.
          </EmptyState>
        }
        {...table}
      />

      {inspecting && (
        <MigrationInspector
          migration={inspecting.migration}
          dialect={DIALECT[conn.type as keyof typeof DIALECT]}
          canRollback={inspecting.canRollback}
          onClose={() => setInspecting(null)}
          onRollback={(m: any) => setRollbackTarget(rows.find((r) => r.migration.version === m.version) || null)}
        />
      )}

      {rollbackTarget && (
        <ConfirmDialog
          title={`Roll back to v${rollbackTarget.migration.version}?`}
          message={`This runs the down SQL for every version newer than v${rollbackTarget.migration.version} against your database, marks them rolled back, and resets the schema version to v${rollbackTarget.migration.version}. This cannot be undone automatically.`}
          confirmLabel={rollingBack ? 'Rolling back…' : 'Roll back'}
          cancelLabel="Cancel"
          danger
          onConfirm={confirmRollback}
          onCancel={() => !rollingBack && setRollbackTarget(null)}
        />
      )}
    </div>
  )
}
