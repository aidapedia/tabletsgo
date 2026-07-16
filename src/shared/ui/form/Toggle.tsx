/**
 * On/off switch, styled like a native iOS-style toggle.
 * Props: checked, onChange(next), disabled, className, ariaLabel.
 */
export default function Toggle({ checked, onChange, disabled = false, className = '', ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-green' : 'bg-elevated ring-1 ring-inset ring-edge-strong'
      } ${className}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0'
        }`}
      />
    </button>
  )
}
