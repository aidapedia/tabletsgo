/**
 * Hover tooltip shared across the app. Wraps a single trigger element.
 *
 *   <Tooltip label="Refresh" placement="bottom">
 *     <button>…</button>
 *   </Tooltip>
 *
 * Pure CSS (group-hover) — no state. `placement`: top | bottom | left | right.
 * `wrapperClassName` lets the wrapper inherit layout utilities (flex-1, etc.).
 */
const PLACEMENT = {
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-2 -translate-x-1/2',
  left: 'right-full top-1/2 mr-2.5 -translate-y-1/2',
  right: 'left-full top-1/2 ml-2.5 -translate-y-1/2',
}

export default function Tooltip({ label, placement = 'top', multiline = false, children, wrapperClassName = '' }) {
  if (!label) return children
  return (
    <span className={`group/tip relative inline-flex ${wrapperClassName}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-[70] scale-95 rounded-soft border border-edge-strong bg-elevated px-2.5 py-1.5 text-[11px] font-medium text-ink opacity-0 shadow-[0_12px_34px_-10px_rgba(0,0,0,0.75)] transition-all duration-150 group-hover/tip:scale-100 group-hover/tip:opacity-100 ${
          multiline ? 'max-w-[280px] whitespace-pre-wrap break-words text-left' : 'whitespace-nowrap'
        } ${PLACEMENT[placement]}`}
      >
        {label}
      </span>
    </span>
  )
}
