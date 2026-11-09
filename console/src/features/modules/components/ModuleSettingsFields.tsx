import NumberStepper from '@/shared/ui/form/NumberStepper'
import type { ModuleSetting } from '../api'
import { FormField } from '@/shared/ui/form/FormField'

/** The form's working copy: one string per setting ('' = back to the default). */
export type SettingsDraft = Record<string, string>

export const draftOf = (settings: ModuleSetting[]): SettingsDraft =>
  Object.fromEntries(settings.map((s) => [s.key, String(s.value)]))

/** What a draft saves: every setting, and an emptied field back to its default. */
export const patchOf = (settings: ModuleSetting[], draft: SettingsDraft) =>
  Object.fromEntries(
    settings.map((s) => [s.key, (draft[s.key] ?? '').trim() === '' ? null : draft[s.key].trim()])
  )

/**
 * A module's instance-wide settings, drawn from the schema the server sends —
 * so a new setting needs no frontend change.
 */
export default function ModuleSettingsFields({
  moduleId,
  settings,
  draft,
  onChange,
}: {
  moduleId: string
  settings: ModuleSetting[]
  draft: SettingsDraft
  onChange: (key: string, value: string) => void
}) {
  return (
    <>
      {settings.map((s) => {
        const id = `module-${moduleId}-${s.key}`
        const raw = draft[s.key] ?? ''
        return (
          <FormField
            key={s.key}
            htmlFor={id}
            label={s.label}
            // The default and range are advice, so they sit in the "?" with the help text.
            help={[
              s.help,
              `Default ${s.default.toLocaleString()}${s.unit ? ` ${s.unit}` : ''} · ${s.min.toLocaleString()}–${s.max.toLocaleString()}`,
            ]
              .filter(Boolean)
              .join('\n')}
          >
            <div className="flex items-center gap-2">
              <NumberStepper
                id={id}
                value={raw.trim() === '' ? null : Number(raw)}
                onChange={(n) => onChange(s.key, n == null ? '' : String(n))}
                min={s.min}
                max={s.max}
                step={s.step}
                allowNull
                placeholder={s.default.toLocaleString()}
                ariaLabel={s.label}
                className="w-40 shrink-0"
              />
              {s.unit && <span className="text-[11px] text-faint">{s.unit}</span>}
            </div>
          </FormField>
        )
      })}
    </>
  )
}
