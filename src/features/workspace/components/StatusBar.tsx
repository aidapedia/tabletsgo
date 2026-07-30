import Tooltip from '@/shared/ui/overlay/Tooltip'
import { DbLogo } from '@/shared/ui/icons'
import { EnvBadge, TYPE_LABEL } from '@/features/connections'

// Thin bar pinned to the bottom of the console's main area (the icon rail and
// Tables sidebar run past it, full height): what you're connected to (database
// type + name + environment) on the left, the schema version on the right.
// The one place that answers "which database am I about to change?".
export default function StatusBar({
  conn,
  database,
  schema,
  onSchemaHistory,
}: {
  conn: any
  database?: string
  schema?: string
  onSchemaHistory: () => void
}) {
  if (!conn) return null
  const namespace = [database, schema].filter(Boolean).join(' / ')
  return (
    <footer className="flex h-[26px] shrink-0 items-center gap-2.5 border-t border-edge bg-panel px-3 text-[11px] text-ink-faint">
      <span className="flex shrink-0 items-center gap-1.5">
        <DbLogo type={conn.type} className="h-3.5 w-3.5" />
        <span className="font-medium text-ink-dim">{TYPE_LABEL[conn.type] || conn.type}</span>
      </span>
      <span className="text-edge-strong">|</span>
      <span className="truncate text-ink-dim">{conn.name}</span>
      <div className="ml-auto flex shrink-0 items-center">
        <Tooltip label="Schema version history" placement="top">
          <button
            type="button"
            onClick={onSchemaHistory}
            className="rounded px-1.5 py-0.5 font-medium transition-colors hover:bg-elevated hover:text-ink"
          >
            v{conn.schemaVersion ?? 1}
          </button>
        </Tooltip>
      </div>
      <EnvBadge environment={conn.environment} dense />
    </footer>
  )
}
