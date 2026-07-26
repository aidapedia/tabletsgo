import { useMemo, useState } from 'react'
import ListRow from '@/shared/ui/ListRow'
import RowLabel from '@/shared/ui/RowLabel'
import Badge from '@/shared/ui/Badge'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import { WandIcon } from '@/shared/ui/icons'
import { TYPE_LABEL } from '@/features/connections'
import { TEMPLATES } from '../catalog'
import type { Template } from '../types'

// Left-rail list of built-in templates (browse only — the catalog ships with
// the app). Filter chips narrow by DB type; clicking a template opens its
// detail in a main-area tab (VSCode-style). Modeled on the other rail panels.
export default function TemplatesPanel({
  dbType,
  activeId,
  onOpen,
}: {
  dbType: string
  activeId: string | null
  onOpen?: (t: Template) => void
}) {
  const dbTypes = useMemo(() => Array.from(new Set(TEMPLATES.flatMap((t) => t.databases))), [])
  const [filter, setFilter] = useState<string>(() => (dbTypes.includes(dbType as any) ? dbType : 'all'))

  const visible = filter === 'all' ? TEMPLATES : TEMPLATES.filter((t) => t.databases.includes(filter as any))

  return (
    <>
      <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
        <span className="text-xs font-semibold">Templates</span>
      </div>

      <div className="flex flex-wrap gap-1.5 px-3.5 pb-2.5">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </FilterChip>
        {dbTypes.map((t) => (
          <FilterChip key={t} active={filter === t} onClick={() => setFilter(t)}>
            {TYPE_LABEL[t] ?? t}
          </FilterChip>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {visible.length === 0 ? (
          <EmptyState className="py-6">No templates for this filter.</EmptyState>
        ) : (
          <div className="flex flex-col gap-0.5">
            {visible.map((t) => (
              <ListRow
                key={t.id}
                active={t.id === activeId}
                onClick={() => onOpen?.(t)}
                icon={<WandIcon className="shrink-0 text-ink-faint" width={14} height={14} />}
              >
                <RowLabel>{t.name}</RowLabel>
                <div className="flex shrink-0 gap-1">
                  {t.databases.map((d) => (
                    <Badge key={d} tone="neutral" dense>
                      {TYPE_LABEL[d] ?? d}
                    </Badge>
                  ))}
                </div>
              </ListRow>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
        active
          ? 'border-edge-strong bg-elevated text-ink'
          : 'border-edge text-ink-dim hover:border-edge-strong hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}
