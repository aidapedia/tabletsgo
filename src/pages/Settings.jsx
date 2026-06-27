import { useNavigate } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext.jsx'
import { ChevronLeft, MonitorIcon, MoonIcon, SunIcon } from '../components/icons.jsx'

const THEMES = [
  { id: 'light', label: 'Light', desc: 'Always use a light appearance', Icon: SunIcon },
  { id: 'dark', label: 'Dark', desc: 'Always use a dark appearance', Icon: MoonIcon },
  { id: 'system', label: 'System', desc: 'Match your operating system', Icon: MonitorIcon },
]

export default function Settings() {
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-[720px] px-6 py-8 max-[720px]:px-4">
        <div className="mb-7 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-soft text-ink-dim hover:bg-elevated hover:text-ink"
            aria-label="Back"
          >
            <ChevronLeft />
          </button>
          <h1 className="text-[19px] font-bold tracking-[-0.3px]">Settings</h1>
        </div>

        <section>
          <h2 className="mb-1 text-sm font-semibold">Appearance</h2>
          <p className="mb-4 text-[12px] text-ink-dim">Choose how Tabletsgo looks to you.</p>

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
        </section>
      </div>
    </div>
  )
}
