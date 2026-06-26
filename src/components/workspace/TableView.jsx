import { useEffect, useMemo, useState } from 'react'
import { getTableData } from '../../db/sqlite.js'
import DataGrid from './DataGrid.jsx'

export default function TableView({ conn, table }) {
  const [columns, setColumns] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      const result = await getTableData(conn, table)
      setColumns(result.columns || [])
      setRows(result.rows || [])
      setLoading(false)
    }
    loadData()
  }, [conn, table])

  const visibleRows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => {
      // Handle array rows
      if (Array.isArray(row)) {
        return row.some((v) => v !== null && String(v).toLowerCase().includes(q))
      }
      // Handle object rows
      return Object.values(row).some((v) => v !== null && String(v).toLowerCase().includes(q))
    })
  }, [rows, filter])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-edge px-[18px] py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate text-[13px] font-bold">{table}</span>
          <span className="shrink-0 rounded-[20px] border border-edge bg-elevated px-2.5 py-[3px] text-xs text-ink-dim">
            {rows.length} rows
          </span>
        </div>
        <input
          className="w-[220px] shrink-0 rounded-[9px] border border-edge bg-elevated px-3 py-2 text-xs text-ink outline-none focus:border-green-dim"
          placeholder="Filter rows…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          disabled={loading}
        />
      </div>
      {loading ? (
        <div className="p-5 text-center text-xs">Loading…</div>
      ) : (
        <DataGrid columns={columns} rows={visibleRows} />
      )}
    </div>
  )
}
