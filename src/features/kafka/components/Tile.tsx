/** A summary tile — a label, a big value and a line of context; `warn` tints it amber. */
export default function Tile({ label, value, unit, sub, warn = false }: { label: string; value: string; unit?: string; sub: string; warn?: boolean }) {
  return (
    <div className={`rounded-card border px-4 py-3 ${warn ? 'border-amber/30 bg-amber/5' : 'border-edge bg-panel'}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-wide ${warn ? 'text-amber' : 'text-ink-faint'}`}>{label}</p>
      <p className="mt-1 text-xl font-bold">
        {value}
        {unit && <span className="ml-1 text-[11px] font-medium text-ink-faint">{unit}</span>}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-ink-faint" title={sub}>
        {sub}
      </p>
    </div>
  )
}
