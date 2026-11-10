import { CheckIcon } from '@/shared/ui/icons'
import ModuleIcon from './ModuleIcon'
import type { AdminModule } from '../api'

const GROUPS = [
  { kind: 'engine', title: 'Databases' },
  { kind: 'feature', title: 'Features' },
] as const

/**
 * Pick-what-this-instance-offers cards, grouped Databases / Features — the
 * first-run wizard's step. Selection state is the caller's.
 */
export default function ModulePicker({
  modules,
  selected,
  onToggle,
}: {
  modules: AdminModule[]
  selected: Record<string, boolean>
  onToggle: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      {GROUPS.map((g) => (
        <section key={g.kind}>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">{g.title}</h3>
          <div className="grid grid-cols-2 gap-2.5 max-[560px]:grid-cols-1">
            {modules
              .filter((m) => m.kind === g.kind)
              .map((m) => {
                const on = !!selected[m.id]
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onToggle(m.id)}
                    className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors ${
                      on ? 'border-primary/60 bg-primary/5' : 'border-border bg-card hover:border-input hover:bg-accent'
                    }`}
                  >
                    <ModuleIcon module={m} className="h-9 w-9" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold">{m.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{m.description}</span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border ${
                        on ? 'border-primary bg-primary text-background' : 'border-input'
                      }`}
                    >
                      {on && <CheckIcon width={11} height={11} />}
                    </span>
                  </button>
                )
              })}
          </div>
        </section>
      ))}
    </div>
  )
}
