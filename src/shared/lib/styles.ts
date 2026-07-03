// Shared Tailwind class strings for repeated UI patterns.
//
// NOTE: button styling has moved to the <Button> component (@/shared/ui/Button)
// — use that instead of class strings. Field/input styling below is still a
// class string (composed onto <input>/<textarea>/<Select>); a dedicated Input
// component could supersede it later.

// Field input / select styling shared across forms.
export const fieldInput =
  'w-full px-3 py-2 bg-elevated border border-edge rounded-soft text-ink text-[11px] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-faint focus:border-green-dim focus:shadow-[0_0_0_3px_rgba(111,207,106,0.22)]'

export const fieldLabel = 'block text-[11px] font-semibold text-ink-dim mb-2'

// Compact square icon button used in sidebar/panel headers.
export const iconMini =
  'flex h-[28px] w-[28px] items-center justify-center rounded-[7px] text-ink-dim hover:bg-elevated hover:text-ink'

export const envDotColor = {
  staging: 'bg-amber',
  production: 'bg-red',
  development: 'bg-green',
  local: 'bg-ink-faint',
}
