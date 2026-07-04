import { CheckIcon } from '@/shared/ui/icons'

/**
 * Small round checkbox used for row selection.
 * Props: checked, indeterminate, onChange(next), className, ariaLabel.
 */
export default function Checkbox({ checked, indeterminate = false, onChange, className = '', ariaLabel, disabled = false }) {
  const on = checked || indeterminate
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange?.(!checked)
      }}
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? 'border-green bg-green text-white' : 'border-edge-strong text-transparent hover:border-ink-faint'
      } ${className}`}
    >
      {indeterminate ? <span className="h-[2px] w-2.5 rounded bg-white" /> : <CheckIcon width={11} height={11} />}
    </button>
  )
}
