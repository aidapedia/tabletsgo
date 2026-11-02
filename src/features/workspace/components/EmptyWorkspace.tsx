import Button from '@/shared/ui/buttons/Button'
import { CodeIcon, HistoryIcon, KeyIcon, TableIcon, TerminalIcon, TopicIcon } from '@/shared/ui/icons'
import { formatCombo } from '@/features/keymap'
import type { ConsoleKind } from '@/shared/config/databaseTypes'

// What "nothing open" says, per console shape.
const COPY: Record<ConsoleKind, { icon: any; title: string; body: string }> = {
  sql: {
    icon: TableIcon,
    title: 'No table selected',
    body: 'Pick a table from the sidebar to browse rows, or start a query to explore your data with SQL.',
  },
  keyspace: {
    icon: KeyIcon,
    title: 'No key selected',
    body: 'Pick a key from the keyspace tree to inspect its value, or open a console to run any Redis command.',
  },
  stream: {
    icon: TopicIcon,
    title: 'No topic selected',
    body: 'Pick a topic to browse its messages and partitions, or open a console to run TOPICS, CONSUME or LAG.',
  },
}

const kbd =
  'inline-flex min-w-[20px] items-center justify-center rounded-[5px] border border-edge bg-elevated px-1.5 py-0.5 text-[11px] text-ink-dim'

/**
 * Nothing open at all. An *empty pane* of a split gets the compact placeholder
 * in EditorPane instead — it only owns half the area.
 */
export default function EmptyWorkspace({
  kind,
  tables,
  bindings,
  onNewQuery,
  onBrowseTables,
  onOpenHistory,
}: {
  kind: ConsoleKind
  tables: string[]
  bindings: any
  onNewQuery: () => void
  onBrowseTables: () => void
  onOpenHistory: () => void
}) {
  const tableless = kind !== 'sql'
  const copy = COPY[kind]
  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto p-8">
      <div className="w-full max-w-[560px] text-center">
        <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-[22px] border border-edge bg-elevated text-ink-faint">
          <copy.icon width={34} height={34} />
        </div>
        <h2 className="mt-7 text-2xl font-bold">{copy.title}</h2>
        <p className="mx-auto mt-3 max-w-[420px] text-sm leading-relaxed text-ink-dim">{copy.body}</p>

        <div className="mt-7 flex items-center justify-center gap-3">
          <Button variant="primary" size="lg" icon={tableless ? TerminalIcon : CodeIcon} onClick={onNewQuery}>
            {tableless ? 'New console' : 'New SQL query'}
          </Button>
          {!tableless && (
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
