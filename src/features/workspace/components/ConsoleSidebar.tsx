import type { ReactNode } from 'react'
import Select from '@/shared/ui/form/Select'
import type { ConsoleKind } from '@/shared/config/databaseTypes'

/**
 * The console's left sidebar: the namespace breadcrumb (a stream engine has no
 * namespaces, so it shows which cluster this is instead), then whichever panel
 * the icon rail has selected (passed in as children).
 *
 * The whole thing collapses to zero width rather than unmounting, so the panel
 * inside keeps its scroll position and state across a collapse; on mobile the
 * same element is the slide-over drawer.
 */
export default function ConsoleSidebar({
  kind,
  ns,
  namespaces,
  onDatabaseChange,
  onSchemaChange,
  clusterId,
  visible,
  children,
}: {
  kind: ConsoleKind
  ns: any
  namespaces: any
  onDatabaseChange: (db: string) => void
  onSchemaChange: (schema: string) => void
  /** A stream engine's cluster id; null until loaded. */
  clusterId?: string | null
  visible: boolean
  children: ReactNode
}) {
  return (
    <div className={`shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${visible ? 'w-[280px]' : 'w-0'}`}>
      <aside className="flex h-full min-h-0 w-[280px] flex-col border-r border-edge bg-panel">
        {kind === 'stream' && clusterId && (
          <div className="flex min-w-0 items-center gap-1 px-4 pt-3 text-[11px]">
            <span className="shrink-0 text-ink-faint">cluster</span>
            <span className="truncate font-medium text-ink" title={clusterId}>
              {clusterId}
            </span>
          </div>
        )}
        {/* Database / schema breadcrumb. A stream engine (Kafka) has neither. */}
        {kind !== 'stream' && (
          <div className="flex items-center gap-0.5 px-3 pt-3">
            <Select
              className="max-w-[110px] rounded px-1.5 py-0.5 text-[11px] font-medium text-ink hover:bg-elevated"
              value={ns.database || ''}
              onChange={onDatabaseChange}
              options={(namespaces.databases || []).map((d: string) => ({ value: d, label: d }))}
              placeholder="database"
            />
            {/* Only SQL engines have schemas — Redis has just its numbered databases. */}
            {kind === 'sql' && (
              <>
                <span className="text-[11px] text-ink-faint">/</span>
                <Select
                  className="max-w-[110px] rounded px-1.5 py-0.5 text-[11px] font-medium text-ink hover:bg-elevated"
                  value={ns.schema || ''}
                  onChange={onSchemaChange}
                  options={(namespaces.schemas || []).map((s: string) => ({ value: s, label: s }))}
                  placeholder="schema"
                />
              </>
            )}
          </div>
        )}
        {children}
      </aside>
    </div>
  )
}
