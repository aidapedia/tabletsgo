// Shared Tailwind class strings for repeated UI patterns.

const btnBase =
  'inline-flex items-center justify-center gap-2 rounded-soft text-xs font-semibold whitespace-nowrap transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed'

export const btn = `${btnBase} px-[18px] py-2.5`
export const btnPrimary = `${btn} bg-green text-[#00441b] shadow-[0_6px_20px_-8px_rgba(116,196,118,0.22)] hover:bg-green-bright`
export const btnGhost = `${btn} bg-elevated text-ink border border-edge hover:bg-card-hover hover:border-edge-strong`
export const btnDanger = `${btnBase} px-[18px] py-2.5 bg-transparent text-red border border-red/30 hover:bg-red/10`

// Field input / select styling shared across login + modal.
export const fieldInput =
  'w-full px-3.5 py-3 bg-elevated border border-edge rounded-soft text-ink text-[11px] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-faint focus:border-green-dim focus:shadow-[0_0_0_3px_rgba(116,196,118,0.22)]'

export const fieldLabel = 'block text-[11px] font-semibold text-ink-dim mb-2'

// DB-type badge. `extra` lets callers set size/font for each context.
export function connIcon(type, extra = '') {
  const variant =
    {
      postgresql: 'bg-elevated text-green border border-edge-strong',
      sqlite: 'bg-gradient-to-br from-[#3498db] to-[#2980b9] text-white',
      redis: 'bg-green text-[#00441b]',
    }[type] || 'bg-elevated text-ink'
  return `flex items-center justify-center flex-shrink-0 rounded-[11px] ${variant} ${extra}`
}

export const envDotColor = {
  staging: 'bg-amber',
  production: 'bg-red',
  development: 'bg-green',
  local: 'bg-ink-faint',
}
