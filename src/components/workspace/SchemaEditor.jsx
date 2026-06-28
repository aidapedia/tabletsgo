import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  BaseEdge,
  Handle,
  MiniMap,
  Position,
  useNodesState,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from '@dagrejs/dagre'
import { getDiagram } from '../../db/sqlite.js'
import Button from '../ui/Button.jsx'
import TableEditPanel from './TableEditPanel.jsx'
import { WandIcon } from '../icons.jsx'

const TYPES = {
  sqlite: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'],
  postgresql: ['SERIAL', 'INTEGER', 'BIGINT', 'TEXT', 'VARCHAR(255)', 'BOOLEAN', 'TIMESTAMP', 'DATE', 'NUMERIC'],
}

// Fixed metrics so per-column handles line up with their rows.
const HEADER_H = 34
const ROW_H = 22
const PAD_T = 4
const rowCenter = (i) => HEADER_H + PAD_T + i * ROW_H + ROW_H / 2

// ---- Custom node: a table with per-column FK handles ----
function TableNode({ data }) {
  return (
    <div className="overflow-hidden rounded-soft border border-edge-strong bg-panel text-[11px] shadow-[0_12px_30px_-12px_rgba(0,0,0,0.7)]">
      <div
        className="flex items-center border-b border-edge bg-elevated px-3 text-[12px] font-bold text-ink"
        style={{ height: HEADER_H }}
      >
        <span className="truncate">{data.name}</span>
      </div>
      <div style={{ paddingTop: PAD_T, paddingBottom: PAD_T }}>
        {data.columns.map((c, i) => {
          const involved = data.srcCols.has(c.name) || data.tgtCols.has(c.name)
          return (
            <div key={c.name} className="flex items-center gap-2 px-3" style={{ height: ROW_H }}>
              {involved && (
                <>
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={`${c.name}-l`}
                    style={{ top: rowCenter(i) }}
                    className="!h-1 !w-1 !min-w-0 !border-0 !bg-transparent"
                  />
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={`${c.name}-r`}
                    style={{ top: rowCenter(i) }}
                    className="!h-1 !w-1 !min-w-0 !border-0 !bg-transparent"
                  />
                </>
              )}
              <span className={`flex-1 truncate ${c.pk ? 'font-semibold text-ink' : 'text-ink-dim'}`}>{c.name}</span>
              <span className="font-mono text-[10px] text-ink-faint">{(c.type || '').toUpperCase()}</span>
              {c.pk && <span className="rounded bg-green/15 px-1 text-[9px] font-bold text-green-bright">PK</span>}
              {data.srcCols.has(c.name) && <span className="rounded bg-amber/15 px-1 text-[9px] font-bold text-amber">FK</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const nodeTypes = { table: TableNode }

const NODE_W = 230 // matches the node style width
const JUMP_R = 5 // hop radius where edges cross
const CORNER_R = 8 // rounded corner radius at turns

// Custom edge: pre-computed rounded path + a dot at each connected endpoint.
function FkEdge({ data, style, markerEnd }) {
  return (
    <>
      <BaseEdge path={data.path} style={style} markerEnd={markerEnd} />
      <circle cx={data.start.x} cy={data.start.y} r={3.5} fill="var(--color-green)" />
      <circle cx={data.end.x} cy={data.end.y} r={3.5} fill="var(--color-green)" />
    </>
  )
}
const edgeTypes = { fk: FkEdge }

// Orthogonal route between two side handles (endpoints already chosen to face
// each other), with a vertical run at the midpoint.
function routePoints(sx, sy, tx, ty) {
  const midX = (sx + tx) / 2
  return [
    { x: sx, y: sy },
    { x: midX, y: sy },
    { x: midX, y: ty },
    { x: tx, y: ty },
  ]
}

// Build an orthogonal path with rounded corners at turns, arcing over any
// crossing vertical segments along horizontal runs.
function pathWithJumps(points, verticals) {
  const n = points.length
  if (n < 2) return ''

  const segs = []
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    segs.push({
      a,
      b,
      len: Math.abs(b.x - a.x) + Math.abs(b.y - a.y),
      ux: b.x === a.x ? 0 : b.x > a.x ? 1 : -1,
      uy: b.y === a.y ? 0 : b.y > a.y ? 1 : -1,
      horizontal: b.y === a.y,
    })
  }
  // Corner radius per interior vertex, clamped to neighbouring segment lengths.
  const cornerR = segs.map((s, i) =>
    i < segs.length - 1 ? Math.min(CORNER_R, s.len / 2, segs[i + 1].len / 2) : 0
  )

  const drawRun = (cx, By, Bx, horizontal, dir) => {
    let out = ''
    if (horizontal) {
      const lo = Math.min(cx, Bx)
      const hi = Math.max(cx, Bx)
      const xs = verticals
        .filter((v) => v.x > lo + 1 && v.x < hi - 1 && By > v.y1 + 1 && By < v.y2 - 1)
        .map((v) => v.x)
        .sort((p, q) => (dir > 0 ? p - q : q - p))
      for (const X of xs) {
        out += ` L ${X - dir * JUMP_R},${By} A ${JUMP_R} ${JUMP_R} 0 0 ${dir > 0 ? 0 : 1} ${X + dir * JUMP_R},${By}`
      }
    }
    out += ` L ${Bx},${By}`
    return out
  }

  let d = `M ${points[0].x},${points[0].y}`
  let cur = { ...points[0] }
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const endR = cornerR[i]
    const bx = s.b.x - s.ux * endR
    const by = s.b.y - s.uy * endR
    d += drawRun(cur.x, s.horizontal ? cur.y : by, bx, s.horizontal, s.ux)
    cur = { x: bx, y: by }
    if (i < segs.length - 1) {
      const ns = segs[i + 1]
      const nx = ns.a.x + ns.ux * endR
      const ny = ns.a.y + ns.uy * endR
      d += ` Q ${s.b.x},${s.b.y} ${nx},${ny}`
      cur = { x: nx, y: ny }
    }
  }
  return d
}

export default function SchemaEditor({ conn, onStage }) {
  const dialect = conn.type === 'postgresql' ? 'postgresql' : 'sqlite'
  const types = TYPES[dialect]

  const [diagram, setDiagram] = useState({ tables: [], foreignKeys: [] })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null) // table name being edited

  useEffect(() => {
    let alive = true
    getDiagram(conn).then((d) => {
      if (!alive) return
      setDiagram(d)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [conn])

  // Per-table FK endpoints: source columns (this table's FKs) and target
  // columns (referenced by other tables) — used to place column handles.
  const fkInfo = useMemo(() => {
    const src = {}
    const tgt = {}
    for (const fk of diagram.foreignKeys) {
      ;(src[fk.table] ||= new Set()).add(fk.column)
      ;(tgt[fk.refTable] ||= new Set()).add(fk.refColumn)
    }
    return { src, tgt }
  }, [diagram])

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const rf = useRef(null)

  // Node size (matches the fixed row metrics) so dagre arranges without overlaps.
  const sizeOf = (t) => ({ w: 230, h: HEADER_H + PAD_T * 2 + t.columns.length * ROW_H })

  // Arrange tables with dagre: ranks follow FK relationships, no collisions.
  const layoutNodes = useCallback(() => {
    const g = new dagre.graphlib.Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 110, marginx: 24, marginy: 24 })

    const sizes = {}
    for (const t of diagram.tables) {
      const s = sizeOf(t)
      sizes[t.name] = s
      g.setNode(t.name, { width: s.w, height: s.h })
    }
    for (const fk of diagram.foreignKeys) {
      if (fk.table !== fk.refTable) g.setEdge(fk.table, fk.refTable)
    }
    dagre.layout(g)

    return diagram.tables.map((t) => {
      const p = g.node(t.name)
      const s = sizes[t.name]
      return {
        id: t.name,
        type: 'table',
        position: { x: p.x - s.w / 2, y: p.y - s.h / 2 },
        style: { width: s.w },
        data: {
          name: t.name,
          columns: t.columns,
          srcCols: fkInfo.src[t.name] || new Set(),
          tgtCols: fkInfo.tgt[t.name] || new Set(),
        },
      }
    })
  }, [diagram, fkInfo])

  // (Re)build nodes whenever the diagram loads.
  useEffect(() => {
    setNodes(layoutNodes())
  }, [diagram, fkInfo, layoutNodes, setNodes])

  // Edges are derived from live node positions, with jump arcs over crossings.
  const edges = useMemo(() => {
    const byId = {}
    for (const n of nodes) byId[n.id] = n

    // Endpoint + raw orthogonal points for each FK.
    const raw = []
    diagram.foreignKeys.forEach((fk, i) => {
      const sn = byId[fk.table]
      const tn = byId[fk.refTable]
      if (!sn || !tn) return
      const si = sn.data.columns.findIndex((c) => c.name === fk.column)
      const ti = tn.data.columns.findIndex((c) => c.name === fk.refColumn)
      if (si < 0 || ti < 0) return
      // Pick the side of each table that faces the other, by their positions.
      const forward = tn.position.x + NODE_W / 2 >= sn.position.x + NODE_W / 2
      const sx = sn.position.x + (forward ? NODE_W : 0)
      const tx = tn.position.x + (forward ? 0 : NODE_W)
      const points = routePoints(sx, sn.position.y + rowCenter(si), tx, tn.position.y + rowCenter(ti))
      raw.push({ id: `e${i}`, fk, points })
    })

    // Collect every vertical segment so each edge can hop over the others.
    const verticals = []
    for (const e of raw) {
      for (let k = 1; k < e.points.length; k++) {
        const a = e.points[k - 1]
        const b = e.points[k]
        if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 0.5) {
          verticals.push({ id: e.id, x: a.x, y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y) })
        }
      }
    }

    return raw.map((e) => ({
      id: e.id,
      source: e.fk.table,
      target: e.fk.refTable,
      type: 'fk',
      style: { stroke: '#6fcf6a', strokeWidth: 1.5 },
      data: {
        path: pathWithJumps(e.points, verticals.filter((v) => v.id !== e.id)),
        start: e.points[0],
        end: e.points[e.points.length - 1],
      },
    }))
  }, [nodes, diagram])

  const autoLayout = () => {
    setNodes(layoutNodes())
    setTimeout(() => rf.current?.fitView({ duration: 300, padding: 0.2 }), 0)
  }

  const selectedTable = selected ? diagram.tables.find((t) => t.name === selected) : null

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Toolbar / action list */}
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <Button variant="primary" size="sm" icon={WandIcon} onClick={autoLayout} disabled={loading || !diagram.tables.length}>
          Organize
        </Button>

        <div className="mx-0.5 h-5 w-px bg-edge" />

        <Button variant="subtle" size="sm" className="!px-2" onClick={() => rf.current?.zoomOut()} aria-label="Zoom out">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 12h14" />
          </svg>
        </Button>
        <Button variant="subtle" size="sm" className="!px-2" onClick={() => rf.current?.zoomIn()} aria-label="Zoom in">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Button>
        <Button
          variant="subtle"
          size="sm"
          className="!px-2"
          onClick={() => rf.current?.fitView({ duration: 300, padding: 0.2 })}
          aria-label="Fit view"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        </Button>

        <span className="ml-1 text-[11px] text-ink-faint">{conn.name} · {diagram.tables.length} table(s)</span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-ink-faint">Loading schema…</div>
          ) : diagram.tables.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-ink-faint">No tables to show.</div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onInit={(inst) => (rf.current = inst)}
              onNodeClick={(_, node) => setSelected(node.id)}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#222" gap={18} />
              <MiniMap
                pannable
                zoomable
                style={{ width: 120, height: 84 }}
                maskColor="rgba(0,0,0,0.55)"
                nodeColor="#2a352a"
                nodeStrokeColor="#6fcf6a"
              />
            </ReactFlow>
          )}
        </div>
      </div>

      {selectedTable && (
        <TableEditPanel
          table={selectedTable}
          dialect={dialect}
          types={types}
          onStage={onStage}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
