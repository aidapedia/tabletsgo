import Checkbox from '../ui/Checkbox.jsx'

// Default fixed-ish column width so columns don't collapse/stretch to fit the
// screen; wide tables overflow and scroll horizontally instead.
const colW = 'min-w-[160px] max-w-[360px]'
const thBase =
  `sticky top-0 z-[1] whitespace-nowrap border-b border-edge bg-elevated px-3.5 py-2.5 text-left font-semibold text-ink-dim ${colW}`
const tdBase =
  `overflow-hidden text-ellipsis whitespace-nowrap border-b border-edge px-3.5 py-[9px] text-ink ${colW}`
const firstTh = `${thBase} left-0 z-[2] text-right !min-w-0`
const firstTd = 'sticky left-0 border-b border-edge bg-panel px-3.5 py-[9px] text-right tabular-nums text-ink-faint'

const EmptyIcon = (props) => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </svg>
)

export default function DataGrid({
  columns,
  rows,
  selectable = false,
  getRowKey,
  selectedKeys,
  onToggleRow,
  onToggleAll,
}) {
  if (!columns || columns.length === 0) {
    return <div className="p-[30px] text-center text-ink-faint">No columns to display.</div>
  }

  const keyOf = (row, i) => (getRowKey ? getRowKey(row, i) : i)
  const allSelected = selectable && rows.length > 0 && rows.every((r, i) => selectedKeys?.has(keyOf(r, i)))
  const someSelected = selectable && !allSelected && rows.some((r, i) => selectedKeys?.has(keyOf(r, i)))

  return (
    <div className="min-h-0 w-full min-w-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className={firstTh}>
              {selectable ? (
                <div className="flex justify-center">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={() => onToggleAll?.()}
                    ariaLabel="Select all rows"
                  />
                </div>
              ) : (
                '#'
              )}
            </th>
            {columns.map((c) => (
              <th key={c} className={thBase}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1}>
                <div className="flex flex-col items-center justify-center gap-3 py-20 text-center text-ink-faint">
                  <EmptyIcon />
                  <div>
                    <div className="text-sm font-medium text-ink-dim">No data found</div>
                    <div className="mt-1 text-[11px]">This table doesn’t have any rows yet.</div>
                  </div>
                </div>
              </td>
            </tr>
          ) : (
            rows.map((row, i) => {
              const key = keyOf(row, i)
              const selected = selectable && selectedKeys?.has(key)
              return (
                <tr key={i} className={selected ? '[&>td]:bg-green/10' : 'hover:[&>td]:bg-card'}>
                  <td className={`${firstTd} ${selected ? '!bg-green/10' : ''}`}>
                    {selectable ? (
                      <div className="flex justify-center">
                        <Checkbox
                          checked={!!selected}
                          onChange={() => onToggleRow?.(row, i)}
                          ariaLabel="Select row"
                        />
                      </div>
                    ) : (
                      i + 1
                    )}
                  </td>
                  {columns.map((c, j) => {
                    const val = Array.isArray(row) ? row[j] : row[c]
                    return (
                      <td key={j} className={tdBase}>
                        {val === null || val === undefined ? (
                          <span className="italic text-ink-faint">NULL</span>
                        ) : (
                          String(val)
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
