import { useState } from 'react'
import { runQuery } from '../../db/sqlite.js'
import DataGrid from './DataGrid.jsx'
import { btnPrimary } from '../../ui.js'

export default function QueryEditor({ conn, dialect, initialSql, onRan }) {
  const [sql, setSql] = useState(initialSql || 'SELECT * FROM events LIMIT 10;')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const run = async () => {
    setError(null)
    setLoading(true)
    try {
      const queryResult = await runQuery(conn, sql)
      if (queryResult.error) {
        setError(queryResult.error)
        setResult(null)
      } else {
        setResult(queryResult)
        const rows = queryResult.type === 'rows' ? queryResult.rows.length : null
        onRan?.({ sql: sql.trim(), ts: Date.now(), rows })
      }
    } catch (e) {
      setResult(null)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const onKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      run()
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-edge px-[18px] py-3">
        <button className={`${btnPrimary} !px-4 !py-2`} onClick={run} disabled={loading}>
          {loading ? '⏳ Running…' : '▶ Run Query'}{' '}
          <kbd className="rounded-[4px] bg-black/20 px-1.5 py-px text-[11px]">⌘↵</kbd>
        </button>
        <span className="ml-auto rounded-[8px] border border-edge bg-elevated px-3 py-1.5 text-[11px] font-semibold text-ink-dim">
          {dialect}
        </span>
      </div>

      <textarea
        className="min-h-[160px] w-full resize-y border-b border-edge bg-bg px-[18px] py-4 font-mono text-xs leading-[1.6] text-ink outline-none"
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        placeholder="Write SQL and press ⌘↵ to run…"
        disabled={loading}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {error && (
          <div className="mx-[18px] my-4 rounded-[9px] border border-red/25 bg-red/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">
            ❌ {error}
          </div>
        )}
        {!error && result?.type === 'rows' && (
          <>
            <div className="border-b border-edge px-[18px] py-2 text-xs text-ink-dim">{result.rows.length} row(s)</div>
            <DataGrid columns={result.columns} rows={result.rows} />
          </>
        )}
        {!error && result?.type === 'message' && (
          <div className="mx-[18px] my-4 rounded-[9px] border border-green-dim bg-green/10 px-3.5 py-3 text-[11px] text-green-bright">
            ✅ {result.message}
          </div>
        )}
        {!error && !result && (
          <div className="p-[30px] text-center text-ink-faint">Run a query to see results here.</div>
        )}
      </div>
    </div>
  )
}
