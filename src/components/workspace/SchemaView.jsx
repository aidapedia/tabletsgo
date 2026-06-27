import { useEffect, useState } from 'react'
import { getColumns } from '../../db/sqlite.js'

const th = 'border-b border-edge bg-elevated px-3 py-1.5 text-left font-semibold text-ink-dim'
const td = 'border-b border-edge px-3 py-1 text-ink'

export default function SchemaView({ conn, table }) {
  const [columns, setColumns] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getColumns(conn, table).then((cols) => {
      if (!alive) return
      setColumns(cols || [])
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [conn, table])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-4 py-2.5 text-xs">
        <span className="font-semibold text-ink">{table}</span>
        <span className="text-ink-faint">schema · {columns.length} column(s)</span>
      </div>

      {loading ? (
        <div className="p-5 text-center text-xs text-ink-faint">Loading…</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr>
                <th className={th}>Column</th>
                <th className={th}>Type</th>
                <th className={th}>Nullable</th>
                <th className={th}>Key</th>
                <th className={th}>Default</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((c) => (
                <tr key={c.name} className="hover:[&>td]:bg-card">
                  <td className={`${td} font-medium`}>{c.name}</td>
                  <td className={`${td} font-mono text-ink-dim`}>{(c.type || '').toUpperCase() || '—'}</td>
                  <td className={td}>
                    {c.notnull ? <span className="text-ink-faint">NOT NULL</span> : <span className="text-ink-dim">nullable</span>}
                  </td>
                  <td className={td}>
                    {c.pk ? (
                      <span className="rounded bg-green/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-green-bright">PK</span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                  <td className={`${td} font-mono text-ink-dim`}>
                    {c.default == null ? <span className="italic text-ink-faint">NULL</span> : String(c.default)}
                  </td>
                </tr>
              ))}
              {columns.length === 0 && (
                <tr>
                  <td className={`${td} text-ink-faint`} colSpan={5}>
                    No columns found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
