/**
 * Reusable segmented toggle (e.g. Fields/JSON, A–Z/Z–A).
 * Props: value, onChange(value), options: [{ value, label }], className.
 */
export default function Segmented({ value, onChange, options, className = '' }) {
  return (
    <div className={`inline-flex rounded-soft border border-edge bg-bg p-0.5 text-[11px] font-semibold ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-[7px] px-3 py-1 transition-colors ${
            value === o.value ? 'bg-elevated text-ink' : 'text-ink-dim hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
