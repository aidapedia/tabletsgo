/** A summary tile — a label, a big value and a line of context; `warn` tints it amber. */
export default function Tile({ label, value, unit, sub, warn = false }: { label: string; value: string; unit?: string; sub: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${warn ? 'border-warning/30 bg-warning/5' : 'border-border bg-sidebar'}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-wide ${warn ? 'text-warning' : 'text-faint'}`}>{label}</p>
      <p className="mt-1 text-xl font-bold">
        {value}
        {unit && <span className="ml-1 text-[11px] font-medium text-faint">{unit}</span>}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-faint" title={sub}>
        {sub}
      </p>
    </div>
  )
}
