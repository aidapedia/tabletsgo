import { useEffect, useState } from 'react'
import { getFunction } from '@/shared/api/database'

// Shows a function's identity signature and its full source definition. A name
// can resolve to several overloads, so each is rendered as its own block.
export default function FunctionView({ conn, name }) {
  const [defs, setDefs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getFunction(conn, name).then((list) => {
      if (!alive) return
      setDefs(list || [])
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [conn, name])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-4 py-2.5 text-xs">
        <span className="font-semibold text-ink">{name}</span>
        <span className="text-ink-faint">function{defs.length > 1 ? ` · ${defs.length} overloads` : ''}</span>
      </div>

      {loading ? (
        <div className="p-5 text-center text-xs text-ink-faint">Loading…</div>
      ) : defs.length === 0 ? (
        <div className="p-5 text-center text-xs text-ink-faint">No definition available.</div>
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {defs.map((f, i) => (
            <div key={i} className="overflow-hidden rounded-soft border border-edge">
              <div className="border-b border-edge bg-elevated px-3 py-1.5 font-mono text-[11px] text-ink-dim">
                {f.name}({f.args})
              </div>
              <pre className="overflow-auto px-3.5 py-3 font-mono text-[11px] leading-[1.6] text-ink-dim">
                {f.definition}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
