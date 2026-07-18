import { useTheme } from '@/app/providers/ThemeContext'
import { MonitorIcon, MoonIcon, SunIcon } from '@/shared/ui/icons'

const BASE_OPTS = [
  { id: 'system', label: 'System', Icon: MonitorIcon },
  { id: 'light', label: 'Light', Icon: SunIcon },
  { id: 'dark', label: 'Dark', Icon: MoonIcon },
]

// Named accent presets shown as swatches. Custom picks are any other hex.
const ACCENTS = [
  { label: 'Green', color: '#6fcf6a' },
  { label: 'Teal', color: '#2dd4bf' },
  { label: 'Blue', color: '#4aa8ff' },
  { label: 'Indigo', color: '#6c7cff' },
  { label: 'Purple', color: '#b98cff' },
  { label: 'Yellow', color: '#e5c454' },
  { label: 'Orange', color: '#ff9d4a' },
  { label: 'Red', color: '#ef5350' },
  { label: 'Pink', color: '#ec4899' },
]

// Section heading that mirrors the page SubHead but shows the live selection.
function Heading({ title, value }) {
  return (
    <div className="mb-4">
      <h3 className="text-[15px] font-bold tracking-[-0.2px]">{title}</h3>
      <p className="mt-0.5 text-[12px] text-ink-dim">{value}</p>
    </div>
  )
}

// A single hollow-ring accent swatch; filled center dot + tile when selected.
function AccentSwatch({ color, label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-9 w-9 items-center justify-center rounded-soft transition-colors ${
        active ? 'bg-elevated ring-1 ring-edge-strong' : 'hover:bg-card-hover'
      }`}
    >
      <span
        className="flex h-6 w-6 items-center justify-center rounded-full border-2"
        style={{ borderColor: color }}
      >
        {active && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      </span>
    </button>
  )
}

// Appearance settings — background (base) + accent color, matching the two
// stacked sections in the design.
export default function AppearanceSetting() {
  const { base, setBase, accent, setAccent } = useTheme()

  const baseLabel = BASE_OPTS.find((b) => b.id === base)?.label ?? 'System'
  const accentLabel =
    ACCENTS.find((a) => a.color.toLowerCase() === accent.toLowerCase())?.label ?? 'Custom'
  const isCustom = accentLabel === 'Custom'

  return (
    <div className="space-y-8">
      <section>
        <Heading title="Background" value={baseLabel} />
        <div className="flex gap-2">
          {BASE_OPTS.map(({ id, label, Icon }) => {
            const active = base === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setBase(id)}
                aria-label={label}
                aria-pressed={active}
                title={label}
                className={`flex h-11 w-11 items-center justify-center rounded-soft transition-colors ${
                  active
                    ? 'bg-elevated text-green ring-1 ring-edge-strong'
                    : 'text-ink-dim hover:bg-card-hover hover:text-ink'
                }`}
              >
                <Icon />
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <Heading title="Accent color" value={accentLabel} />
        <div className="flex flex-wrap items-center gap-1.5">
          {ACCENTS.map((a) => (
            <AccentSwatch
              key={a.color}
              color={a.color}
              label={a.label}
              active={a.color.toLowerCase() === accent.toLowerCase()}
              onClick={() => setAccent(a.color)}
            />
          ))}

          {/* Custom — native color well behind a dashed (or filled, when active) ring. */}
          <label
            title="Custom"
            className={`relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-soft transition-colors ${
              isCustom ? 'bg-elevated ring-1 ring-edge-strong' : 'hover:bg-card-hover'
            }`}
          >
            <span
              className="h-6 w-6 rounded-full border-2 border-dashed"
              style={isCustom ? { borderStyle: 'solid', borderColor: accent } : { borderColor: 'var(--color-edge-strong)' }}
            />
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              aria-label="custom accent color"
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        </div>
      </section>
    </div>
  )
}
