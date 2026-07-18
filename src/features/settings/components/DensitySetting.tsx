import { useTheme } from '@/app/providers/ThemeContext'
import Select from '@/shared/ui/form/Select'
import { controlClass } from '@/shared/ui/form/Input'

const OPTIONS = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
  { value: 'condensed', label: 'Condensed' },
]

// Density — a normal labelled settings row (matches the Data tab), with a
// Select that scales the root font-size (see ThemeContext / index.css).
export default function DensitySetting() {
  const { density, setDensity } = useTheme()

  return (
    <div className="flex items-center justify-between gap-4 rounded-card border border-edge bg-card p-4">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">Interface density</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">
          Scale spacing and text size across the whole app.
        </div>
      </div>
      <div className="w-40 shrink-0">
        <Select value={density} onChange={setDensity} options={OPTIONS} className={controlClass} />
      </div>
    </div>
  )
}
