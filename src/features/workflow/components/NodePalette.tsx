import { CATEGORIES, specsByCategory } from '@/features/workflow/lib/nodeSpec'
import type { NodeType } from '@/features/workflow/lib/nodeSpec'

// Grouped node picker (Trigger / Source / Script / Control). Rendered inside the
// "+" Popover on the canvas; picking a node adds it at the canvas centre.
// `allow` filters which node types are offered (e.g. only a trigger when the
// workflow is empty, or every non-trigger once a trigger already exists).
export default function NodePalette({
  onAdd,
  allow = () => true,
}: {
  onAdd: (type: NodeType) => void
  allow?: (type: NodeType) => boolean
}) {
  return (
    <div className="nowheel max-h-[420px] overflow-y-auto p-1.5">
      {CATEGORIES.map((cat) => {
        const specs = specsByCategory(cat).filter((s) => allow(s.type))
        if (!specs.length) return null
        return (
        <div key={cat} className="mb-1.5 last:mb-0">
          <div className="px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{cat}</div>
          {specs.map((spec) => {
            const Icon = spec.icon
            return (
              <button
                key={spec.type}
                onClick={() => onAdd(spec.type)}
                className="flex w-full items-start gap-2.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-card-hover"
              >
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-elevated ${spec.accent}`}>
                  <Icon width={14} height={14} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-ink">{spec.label}</span>
                  <span className="block text-[10px] leading-tight text-ink-faint">{spec.description}</span>
                </span>
              </button>
            )
          })}
        </div>
        )
      })}
    </div>
  )
}
