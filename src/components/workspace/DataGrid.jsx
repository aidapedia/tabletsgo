// Default fixed-ish column width so columns don't collapse/stretch to fit the
// screen; wide tables overflow and scroll horizontally instead.
const colW = 'min-w-[160px] max-w-[360px]'
const thBase =
  `sticky top-0 z-[1] whitespace-nowrap border-b border-edge bg-elevated px-3.5 py-2.5 text-left font-semibold text-ink-dim ${colW}`
const tdBase =
  `overflow-hidden text-ellipsis whitespace-nowrap border-b border-edge px-3.5 py-[9px] text-ink ${colW}`
const rowNumTh = `${thBase} left-0 z-[2] text-right !min-w-0`
const rowNumTd = 'sticky left-0 border-b border-edge bg-panel px-3.5 py-[9px] text-right tabular-nums text-ink-faint'

const EmptyIcon = (props) => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </svg>
)

export default function DataGrid({ columns, rows }) {
  if (!columns || columns.length === 0) {
    return <div className="p-[30px] text-center text-ink-faint">No columns to display.</div>
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="min-w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className={rowNumTh}>#</th>
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
            rows.map((row, i) => (
              <tr key={i} className="hover:[&>td]:bg-card">
                <td className={rowNumTd}>{i + 1}</td>
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
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
