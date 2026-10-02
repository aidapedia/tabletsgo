import type { ReactNode } from 'react'
import Select from '@/shared/ui/form/Select'

/**
 * The console's left sidebar: the namespace breadcrumb, then whichever panel
 * the icon rail has selected (passed in as children).
 *
 * The whole thing collapses to zero width rather than unmounting, so the panel
 * inside keeps its scroll position and state across a collapse; on mobile the
 * same element is the slide-over drawer.
 */
export default function ConsoleSidebar({
  isRedis,
  ns,
  namespaces,
  onDatabaseChange,
  onSchemaChange,
  visible,
  children,
}: {
  isRedis: boolean
  ns: any
  namespaces: any
  onDatabaseChange: (db: string) => void
  onSchemaChange: (schema: string) => void
  visible: boolean
  children: ReactNode
}) {
  return (
    <div className={`shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${visible ? 'w-[280px]' : 'w-0'}`}>
      <aside className="flex h-full min-h-0 w-[280px] flex-col border-r border-edge bg-panel">
        {/* Database / schema breadcrumb */}
        <div className="flex items-center gap-0.5 px-3 pt-3">
          <Select
            className="max-w-[110px] rounded px-1.5 py-0.5 text-[11px] font-medium text-ink hover:bg-elevated"
            value={ns.database || ''}
            onChange={onDatabaseChange}
            options={(namespaces.databases || []).map((d: string) => ({ value: d, label: d }))}
            placeholder="database"
          />
          {/* Redis has no schemas — only its numbered databases. */}
          {!isRedis && (
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
        {children}
      </aside>
    </div>
  )
}
