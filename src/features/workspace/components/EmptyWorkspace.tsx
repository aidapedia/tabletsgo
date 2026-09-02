import Button from '@/shared/ui/buttons/Button'
import { CodeIcon, HistoryIcon, KeyIcon, TableIcon, TerminalIcon } from '@/shared/ui/icons'
import { formatCombo } from '@/features/keymap'

const kbd =
  'inline-flex min-w-[20px] items-center justify-center rounded-[5px] border border-edge bg-elevated px-1.5 py-0.5 text-[11px] text-ink-dim'

/**
 * Nothing open at all. An *empty pane* of a split gets the compact placeholder
 * in EditorPane instead — it only owns half the area.
 */
export default function EmptyWorkspace({
  isRedis,
  tables,
  bindings,
  onNewQuery,
  onBrowseTables,
  onOpenHistory,
}: {
  isRedis: boolean
  tables: string[]
  bindings: any
  onNewQuery: () => void
  onBrowseTables: () => void
  onOpenHistory: () => void
}) {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto p-8">
      <div className="w-full max-w-[560px] text-center">
        <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-[22px] border border-edge bg-elevated text-ink-faint">
          {isRedis ? <KeyIcon width={34} height={34} /> : <TableIcon width={34} height={34} />}
        </div>
        <h2 className="mt-7 text-2xl font-bold">{isRedis ? 'No key selected' : 'No table selected'}</h2>
        <p className="mx-auto mt-3 max-w-[420px] text-sm leading-relaxed text-ink-dim">
          {isRedis
            ? 'Pick a key from the keyspace tree to inspect its value, or open a console to run any Redis command.'
            : 'Pick a table from the sidebar to browse rows, or start a query to explore your data with SQL.'}
        </p>

        <div className="mt-7 flex items-center justify-center gap-3">
          <Button variant="primary" size="lg" icon={isRedis ? TerminalIcon : CodeIcon} onClick={onNewQuery}>
            {isRedis ? 'New console' : 'New SQL query'}
          </Button>
          {!isRedis && (
            <Button variant="ghost" size="lg" icon={TableIcon} onClick={onBrowseTables} disabled={tables.length === 0}>
              Browse tables
            </Button>
          )}
        </div>

        <div className="mt-9">
          <Button variant="ghost" size="lg" icon={HistoryIcon} onClick={onOpenHistory}>
            View query history
          </Button>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-[11px] text-ink-faint">
          <span className="flex items-center gap-1.5"><kbd className={kbd}>{formatCombo(bindings['general.search'])}</kbd> Search tables</span>
          <span className="flex items-center gap-1.5"><kbd className={kbd}>{formatCombo(bindings['workspace.runQuery'])}</kbd> Run query</span>
          <span className="flex items-center gap-1.5"><kbd className={kbd}>{formatCombo(bindings['general.newTab'])}</kbd> New query</span>
        </div>
      </div>
    </div>
  )
}
