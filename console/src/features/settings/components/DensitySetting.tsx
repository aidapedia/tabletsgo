import { useTheme } from '@/app/providers/ThemeContext'
import OptionSelect from '@/shared/ui/form/OptionSelect'

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
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">Interface density</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          Scale spacing and text size across the whole app.
        </div>
      </div>
      <div className="w-40 shrink-0">
        <OptionSelect value={density} onChange={setDensity} options={OPTIONS} />
      </div>
    </div>
  )
}
