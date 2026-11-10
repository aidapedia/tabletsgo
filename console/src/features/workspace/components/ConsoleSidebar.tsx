import type { ReactNode } from 'react'
import type { ConsoleKind } from '@/shared/config/databaseTypes'
import OptionSelect from '@/shared/ui/form/OptionSelect'

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
      <aside className="flex h-full min-h-0 w-[280px] flex-col border-r border-border bg-sidebar">
        {kind === 'stream' && clusterId && (
          <div className="flex min-w-0 items-center gap-1 px-4 pt-3 text-[11px]">
            <span className="shrink-0 text-faint">cluster</span>
            <span className="truncate font-medium text-foreground" title={clusterId}>
              {clusterId}
            </span>
          </div>
        )}
        {/* Database / schema breadcrumb. A stream engine (Kafka) has neither. */}
        {kind !== 'stream' && (
          <div className="flex items-center gap-0.5 px-3 pt-3">
            <OptionSelect
              variant="ghost"
              className="max-w-[110px] text-[11px] text-foreground"
              aria-label="Database"
              value={ns.database || ''}
              onChange={onDatabaseChange}
              options={(namespaces.databases || []).map((d: string) => ({ value: d, label: d }))}
              placeholder="database"
            />
            {/* Redis has just its numbered databases; to MySQL a schema is a database. */}
            {namespaces.schemas?.length > 0 && (
              <>
                <span className="text-[11px] text-faint">/</span>
                <OptionSelect
                  variant="ghost"
                  className="max-w-[110px] text-[11px] text-foreground"
                  aria-label="Schema"
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
