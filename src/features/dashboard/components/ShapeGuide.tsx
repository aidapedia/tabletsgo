import { useMemo, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import { InfoIcon } from '@/shared/ui/icons'
import type { WidgetType } from '../types'
import { WIDGET_GUIDE, recommendQuery } from '../lib/widgetGuide'

// "How do I feed this diagram?" — the column roles for the selected widget
// type, a query recommended from the connection's own tables/columns (when a
// schema is available), and a generic fallback example. Rendered inline (not
// in a popover) because the editor body scrolls, which would clip an overlay.
export default function ShapeGuide({
  type,
  schema,
  onUseExample,
}: {
  type: WidgetType
  schema?: Record<string, string[]>
  onUseExample?: (sql: string) => void
}) {
  const [open, setOpen] = useState(false)
  const guide = WIDGET_GUIDE[type]
  const recommended = useMemo(() => recommendQuery(type, schema), [type, schema])

  return (
    <div className="mt-2 rounded-soft border border-edge bg-card/60 p-2.5">
      <div className="flex items-center gap-1.5">
        <InfoIcon width={13} height={13} className="shrink-0 text-ink-faint" />
        <span className="text-[11px] font-semibold text-ink-dim">Expected data shape</span>
        {!recommended && guide.example && (
          <TextButton className="ml-auto" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide example' : 'Show example'}
          </TextButton>
        )}
      </div>

      <ul className="mt-1.5 space-y-1">
        {guide.columns.map((c) => (
          <li key={c.label} className="flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
            <code className="shrink-0 rounded bg-elevated px-1 py-px font-mono text-[10px] text-ink">{c.label}</code>
            <span className="text-ink-faint">{c.role}</span>
          </li>
        ))}
      </ul>

      {recommended && (
        <div className="mt-2">
          <span className="text-[11px] font-semibold text-ink-dim">Recommended for your schema</span>
          <pre className="mt-1.5 overflow-x-auto rounded border border-edge bg-bg p-2 font-mono text-[10.5px] leading-relaxed text-ink-dim">
            {recommended}
          </pre>
          <div className="mt-1.5 flex items-center gap-2.5">
            {onUseExample && (
              <Button size="sm" onClick={() => onUseExample(recommended)}>
                Use this query
              </Button>
            )}
            <span className="text-[10px] text-ink-faint">A starting point — adjust the columns to what you need.</span>
          </div>
        </div>
      )}

      {open && !recommended && guide.example && (
        <>
          <pre className="mt-2 overflow-x-auto rounded border border-edge bg-bg p-2 font-mono text-[10.5px] leading-relaxed text-ink-dim">
            {guide.example}
          </pre>
          <div className="mt-1.5 flex items-center gap-2.5">
            {onUseExample && (
              <Button size="sm" onClick={() => onUseExample(guide.example)}>
                Use this example
              </Button>
            )}
            <span className="text-[10px] text-ink-faint">Template — swap in your own tables and columns.</span>
          </div>
        </>
      )}
    </div>
  )
}
