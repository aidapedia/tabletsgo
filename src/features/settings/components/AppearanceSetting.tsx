import { useTheme } from '@/app/providers/ThemeContext'
import { MonitorIcon, MoonIcon, SunIcon } from '@/shared/ui/icons'

const THEMES = [
  { id: 'light', label: 'Light', desc: 'Always use a light appearance', Icon: SunIcon },
  { id: 'dark', label: 'Dark', desc: 'Always use a dark appearance', Icon: MoonIcon },
  { id: 'system', label: 'System', desc: 'Match your operating system', Icon: MonitorIcon },
]

// Theme picker — the "Appearance / Theme" setting control (no section chrome).
export default function AppearanceSetting() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="grid grid-cols-3 gap-3 max-[520px]:grid-cols-1">
      {THEMES.map(({ id, label, desc, Icon }) => {
        const active = theme === id
        return (
          <button
            key={id}
            onClick={() => setTheme(id)}
            className={`flex flex-col items-start gap-3 rounded-card border p-4 text-left transition-all ${
              active
                ? 'border-green bg-card-hover shadow-[0_0_0_3px_rgba(111,207,106,0.18)]'
                : 'border-edge bg-card hover:border-edge-strong hover:bg-card-hover'
            }`}
          >
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-[10px] ${
                active ? 'bg-green text-white' : 'bg-elevated text-ink-dim'
              }`}
            >
              <Icon />
            </span>
            <div>
              <div className="text-[13px] font-semibold">{label}</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">{desc}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
