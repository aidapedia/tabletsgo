import Tooltip from '@/shared/ui/overlay/Tooltip'
import { DbLogo } from '@/shared/ui/icons'
import { EnvBadge, TYPE_LABEL } from '@/features/connections'
import { consoleKindOf } from '@/shared/config/databaseTypes'

// Thin bar pinned to the bottom of the console's main area (the icon rail and
// Tables sidebar run past it, full height): what you're connected to (database
// type + server version + name + environment) on the left, the schema version on the right.
// The one place that answers "which database am I about to change?" — and, when
// the focused tab is about one thing (a Kafka topic), what that thing looks like.
export default function StatusBar({
  conn,
  serverVersion,
  detail,
  database,
  schema,
  subject,
  onSchemaHistory,
}: {
  conn: any
  /** The server's version ("7.4.8"), when the engine reports one. */
  serverVersion?: string | null
  /** A short engine-specific fact beside the name ("3 brokers"). */
  detail?: string | null
  database?: string
  schema?: string
  /** The focused tab's subject and its shape ("orders" · "6 partitions", "RF 3"). */
  subject?: { name: string; facts: string[] } | null
  onSchemaHistory: () => void
}) {
  if (!conn) return null
  const namespace = [database, schema].filter(Boolean).join(' / ')
  const sql = consoleKindOf(conn.type) === 'sql'
  return (
    <footer className="flex h-[26px] shrink-0 items-center gap-2.5 border-t border-edge bg-panel px-3 text-[11px] text-ink-faint">
      <span className="flex shrink-0 items-center gap-1.5">
        <DbLogo type={conn.type} className="h-3.5 w-3.5" />
        <span className="font-medium text-ink-dim">{TYPE_LABEL[conn.type] || conn.type}</span>
        {serverVersion && (
          <Tooltip label="Server version" placement="top">
            <span className="font-mono">{serverVersion}</span>
          </Tooltip>
        )}
      </span>
      <span className="text-edge-strong">|</span>
      <span className="truncate text-ink-dim">{conn.name}</span>
      {detail && (
        <>
          <span className="text-edge-strong">|</span>
          <span className="shrink-0">{detail}</span>
        </>
      )}
      {/* Schemaless engines (Redis, Kafka) never run DDL, so their schema version
          would sit at v1 forever — show the current namespace there instead. */}
      <div className="ml-auto flex min-w-0 items-center gap-2.5">
        {subject && (
          <Tooltip label={[subject.name, ...subject.facts].join('\n')} placement="top" multiline wrapperClassName="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5 truncate">
              <span className="truncate font-mono text-ink-dim">{subject.name}</span>
              {subject.facts.map((f) => (
                <span key={f} className="hidden shrink-0 before:mr-1.5 before:content-['·'] md:inline">
                  {f}
                </span>
              ))}
            </span>
          </Tooltip>
        )}
        {subject && (namespace || sql) && <span className="text-edge-strong">|</span>}
        {!sql ? (
          namespace && <span className="px-1.5 py-0.5 font-medium">{namespace}</span>
        ) : (
          <Tooltip label="Schema version history" placement="top">
            <button
              type="button"
              onClick={onSchemaHistory}
              className="rounded px-1.5 py-0.5 font-medium transition-colors hover:bg-elevated hover:text-ink"
            >
              v{conn.schemaVersion ?? 1}
            </button>
          </Tooltip>
        )}
      </div>
      <EnvBadge environment={conn.environment} dense />
    </footer>
  )
}
