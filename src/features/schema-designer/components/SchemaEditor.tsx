import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  BaseEdge,
  getRectOfNodes,
  getTransformForBounds,
  Handle,
  MiniMap,
  Position,
  useNodesState,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from '@dagrejs/dagre'
import { toJpeg, toPng, toSvg } from 'html-to-image'
import { getDiagram } from '@/shared/api/database'
import Button from '@/shared/ui/Button'
import Popover from '@/shared/ui/Popover'
import Checkbox from '@/shared/ui/Checkbox'
import TableEditPanel from '@/features/schema-designer/components/TableEditPanel'
import CreateTablePanel from '@/features/schema-designer/components/CreateTablePanel'
import SaveQueryPanel from '@/shared/ui/SaveQueryPanel'
import { newItemId } from '@/shared/lib/schemaDraft'
import { useColumnTypes } from '@/features/schema-designer/components/columnFields'
import { ChevronRight, ColumnsIcon, DownloadIcon, EditIcon, PlusIcon, SaveIcon, TableIcon, TrashIcon, WandIcon } from '@/shared/ui/icons'

// Fixed metrics so per-column handles line up with their rows.
const HEADER_H = 34
const ROW_H = 22
const PAD_T = 4
const rowCenter = (i) => HEADER_H + PAD_T + i * ROW_H + ROW_H / 2

// ---- Custom node: a table with per-column FK handles ----
function TableNode({ data, selected }) {
  // Pending (staged-but-uncommitted) tables/columns are marked amber.
  return (
    <div
      className={`group cursor-pointer overflow-hidden rounded-soft border-2 bg-panel text-[11px] shadow-[0_12px_30px_-12px_rgba(0,0,0,0.7)] transition-colors hover:border-green-bright ${
        selected ? 'border-[var(--color-green)]' : data.pending ? 'border-amber' : 'border-edge-strong'
      }`}
    >
      <div
        className={`flex items-center gap-2 border-b px-3 text-[12px] font-bold ${
          data.pending ? 'border-amber/40 bg-amber/20 text-amber' : 'border-edge bg-elevated text-ink'
        }`}
        style={{ height: HEADER_H }}
      >
        <span className="truncate">{data.name}</span>
        {data.pending && <span className="rounded bg-amber/20 px-1 text-[9px] font-bold uppercase tracking-wide text-amber">staged</span>}
      </div>
      <div style={{ paddingTop: PAD_T, paddingBottom: PAD_T }}>
        {data.columns.map((c, i) => {
          const involved = data.srcCols.has(c.name) || data.tgtCols.has(c.name)
          const pendingCol = data.pendingCols.has(c.name)
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
              <span
                className={`flex-1 truncate ${
                  pendingCol ? 'text-amber' : c.pk ? 'font-semibold text-ink' : 'text-ink-dim'
                }`}
              >
                {c.name}
              </span>
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

// ---- Parse staged change SQL into pending tables / columns ----
function parsePendingColumns(body) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of body) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts
    .map((p) => {
      const m = p.trim().match(/^"([^"]+)"\s+(\S+)/)
      return m ? { name: m[1], type: m[2] } : null
    })
    .filter(Boolean)
}

function parsePending(changes) {
  const newTables = {} // name -> [{name,type}]
  const newCols = {} // table -> { colName: type }
  for (const ch of changes || []) {
    const sql = ch.sql || ''
    let m = sql.match(/^\s*CREATE TABLE\s+"([^"]+)"\s*\(([\s\S]*)\)\s*;?\s*$/i)
    if (m) {
      newTables[m[1]] = parsePendingColumns(m[2])
      continue
    }
    m = sql.match(/^\s*ALTER TABLE\s+"([^"]+)"\s+ADD COLUMN\s+"([^"]+)"\s+(\S+)/i)
    if (m) (newCols[m[1]] ||= {})[m[2]] = m[3]
  }
  return { newTables, newCols }
}

const ctlBtn = 'flex h-7 w-7 items-center justify-center rounded text-ink-dim transition-colors hover:bg-card-hover hover:text-ink'
const exportItem =
  'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[12px] text-ink-dim transition-colors hover:bg-card-hover hover:text-ink'

// Reusable export format list (used by the toolbar dropdown and the canvas menu).
function ExportOptions({ onExport }) {
  return (
    <div className="p-1">
      <button className={exportItem} onClick={() => onExport('png')}>
        <DownloadIcon width={14} height={14} /> PNG image
      </button>
      <button className={exportItem} onClick={() => onExport('jpg')}>
        <DownloadIcon width={14} height={14} /> JPG image
      </button>
      <button className={exportItem} onClick={() => onExport('svg')}>
        <DownloadIcon width={14} height={14} /> SVG vector
      </button>
    </div>
  )
}
const NODE_W = 230 // matches the node style width
const JUMP_R = 5 // hop radius where edges cross
const CORNER_R = 8 // rounded corner radius at turns

// Custom edge: pre-computed rounded path + a dot at each connected endpoint.
// Endpoint dots follow the edge's stroke colour so they match the theme.
function FkEdge({ data, style, markerEnd }) {
  const dot = style?.stroke || 'var(--color-ink)'
  return (
    <>
      <BaseEdge path={data.path} style={style} markerEnd={markerEnd} />
      <circle cx={data.start.x} cy={data.start.y} r={3.5} fill={dot} />
      <circle cx={data.end.x} cy={data.end.y} r={3.5} fill={dot} />
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

export default function SchemaEditor({ conn, changes, pending = [], onPendingChange, onStageItems, onSaveDraft, onOpenTable, onOpenSchema }) {
  const dialect = conn.type === 'postgresql' ? 'postgresql' : 'sqlite'
  const types = useColumnTypes(conn)

  const [diagram, setDiagram] = useState({ tables: [], foreignKeys: [] })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null) // table name being edited
  const [selectedEdge, setSelectedEdge] = useState(null) // clicked FK edge id
  const [hoveredEdge, setHoveredEdge] = useState(null) // FK edge under the cursor
  const [edgePopup, setEdgePopup] = useState(null) // { x, y, fk } — FK info popup
  const [hiddenTables, setHiddenTables] = useState(() => new Set()) // tables hidden from the diagram
  const [tableSearch, setTableSearch] = useState('') // filter for the show/hide list
  const [menu, setMenu] = useState(null) // canvas context menu { x, y }
  const [nodeMenu, setNodeMenu] = useState(null) // table right-click menu { x, y, table, pending }
  const [creating, setCreating] = useState(false) // create-table panel open
  const [naming, setNaming] = useState(false) // "save as draft" name prompt open

  // Pending changes are owned by the workspace (per tab) so they survive tab
  // switches; the panels hand their statements up via onPendingChange.
  const addPending = (statements, tableName, mode) =>
    onPendingChange?.([...pending, ...statements.map((sql) => ({ id: newItemId(), sql, table: tableName, mode }))])
  const clearPending = () => onPendingChange?.([])

  // Delete a table: a pending (uncommitted) table just drops its staged
  // statements; an existing table stages a DROP TABLE for the next commit.
  const deleteTable = (table, isPending) => {
    if (isPending) onPendingChange?.(pending.filter((p) => p.table !== table))
    else addPending([`DROP TABLE "${table}";`], table, 'delete')
  }

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

  // Merge committed schema with pending edits (local bar) + staged Changes.
  const augmented = useMemo(() => {
    const { newTables, newCols } = parsePending([...pending, ...(changes || [])])
    const existing = new Set(diagram.tables.map((t) => t.name))
    const tables = diagram.tables.map((t) => {
      const add = newCols[t.name]
      const pendingCols = new Set()
      let columns = t.columns
      if (add) {
        const extra = Object.entries(add)
          .filter(([c]) => !t.columns.some((x) => x.name === c))
          .map(([c, type]) => ({ name: c, type }))
        extra.forEach((c) => pendingCols.add(c.name))
        columns = [...t.columns, ...extra]
      }
      return { ...t, columns, pending: false, pendingCols }
    })
    for (const [name, cols] of Object.entries(newTables)) {
      if (existing.has(name)) continue
      tables.push({ name, columns: cols, pending: true, pendingCols: new Set() })
    }
    return tables
  }, [diagram, changes, pending])

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const rf = useRef(null)

  // Node size (matches the fixed row metrics) so dagre arranges without overlaps.
  const sizeOf = (t) => ({ w: 230, h: HEADER_H + PAD_T * 2 + t.columns.length * ROW_H })

  // Arrange tables with dagre: ranks follow FK relationships, no collisions.
  const layoutNodes = useCallback(() => {
    const g = new dagre.graphlib.Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 110, marginx: 24, marginy: 24 })

    const visible = augmented.filter((t) => !hiddenTables.has(t.name))
    const sizes = {}
    for (const t of visible) {
      const s = sizeOf(t)
      sizes[t.name] = s
      g.setNode(t.name, { width: s.w, height: s.h })
    }
    for (const fk of diagram.foreignKeys) {
      if (fk.table !== fk.refTable && !hiddenTables.has(fk.table) && !hiddenTables.has(fk.refTable)) {
        g.setEdge(fk.table, fk.refTable)
      }
    }
    dagre.layout(g)

    return visible.map((t) => {
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
          pending: t.pending,
          pendingCols: t.pendingCols,
          srcCols: fkInfo.src[t.name] || new Set(),
          tgtCols: fkInfo.tgt[t.name] || new Set(),
        },
      }
    })
  }, [augmented, diagram, fkInfo, hiddenTables])

  const toggleTable = (name) =>
    setHiddenTables((s) => {
      const n = new Set(s)
      n.has(name) ? n.delete(name) : n.add(name)
      return n
    })
  const showAllTables = () => setHiddenTables(new Set())
  const hideAllTables = () => setHiddenTables(new Set(augmented.map((t) => t.name)))

  // (Re)build nodes whenever the diagram or staged changes update.
  useEffect(() => {
    setNodes(layoutNodes())
  }, [layoutNodes, setNodes])

  // Edges are derived from live node positions, with jump arcs over crossings.
  const baseEdges = useMemo(() => {
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
      data: {
        fk: e.fk,
        path: pathWithJumps(e.points, verticals.filter((v) => v.id !== e.id)),
        start: e.points[0],
        end: e.points[e.points.length - 1],
      },
    }))
  }, [nodes, diagram])

  // Apply theme colour + selection state without recomputing the routed paths.
  // FK lines use the ink colour (white on dark, black on light); the selected
  // edge animates (marching dots) and highlights green.
  const edges = useMemo(
    () =>
      baseEdges.map((e) => {
        const isSel = e.id === selectedEdge
        const isHover = !isSel && e.id === hoveredEdge
        const active = isSel || isHover
        return {
          ...e,
          animated: isSel, // drives React Flow's marching-ants animation
          style: {
            stroke: active ? 'var(--color-green)' : 'var(--color-ink)',
            strokeWidth: active ? 2 : 1.5,
            // Round dotted pattern so the animation reads as "moving dots".
            ...(isSel ? { strokeDasharray: '0.1 6', strokeLinecap: 'round' } : {}),
          },
        }
      }),
    [baseEdges, selectedEdge, hoveredEdge]
  )

  const autoLayout = () => {
    setNodes(layoutNodes())
    setTimeout(() => rf.current?.fitView({ duration: 300, padding: 0.2 }), 0)
  }

  // Export the whole diagram (all nodes) as a PNG/JPG image.
  const exportImage = async (fmt) => {
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement
    if (!viewport || !nodes.length) return
    const pad = 48
    const bounds = getRectOfNodes(nodes)
    const w = Math.ceil(bounds.width) + pad * 2
    const h = Math.ceil(bounds.height) + pad * 2
    const [x, y, zoom] = getTransformForBounds(bounds, w, h, 1, 1)
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || '#080808'
    const opts = {
      backgroundColor: bg,
      width: w,
      height: h,
      pixelRatio: 2,
      style: { width: `${w}px`, height: `${h}px`, transform: `translate(${x}px, ${y}px) scale(${zoom})` },
    }
    const fn = fmt === 'jpg' ? toJpeg : fmt === 'svg' ? toSvg : toPng
    const dataUrl = await fn(viewport, fmt === 'jpg' ? { ...opts, quality: 0.95 } : opts)
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${conn.name || 'schema'}.${fmt}`
    a.click()
  }

  const selectedTable = selected ? diagram.tables.find((t) => t.name === selected) : null
  // Foreign keys originating from the selected table (shown read-only per column).
  const selectedForeignKeys = selected ? diagram.foreignKeys.filter((fk) => fk.table === selected) : []

  // Table -> column-name list, for the FK "references" pickers in the panels.
  const schemaMap = useMemo(() => {
    const m = {}
    for (const t of augmented) m[t.name] = t.columns.map((c) => c.name)
    return m
  }, [augmented])
  const tableNames = Object.keys(schemaMap)

  // Close the canvas context menu on any outside interaction.
  useEffect(() => {
    if (!menu && !nodeMenu) return
    const close = () => {
      setMenu(null)
      setNodeMenu(null)
    }
    const onKey = (e) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, nodeMenu])

  // Dismiss the FK popup (and clear the edge selection) on Escape / resize.
  useEffect(() => {
    if (!edgePopup) return
    const close = () => {
      setEdgePopup(null)
      setSelectedEdge(null)
    }
    const onKey = (e) => e.key === 'Escape' && close()
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [edgePopup])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Toolbar / action list — Save sits on the left; Export on the right.
          Save is always shown but disabled until there are pending changes. */}
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <Button
          variant="primary"
          size="sm"
          icon={SaveIcon}
          onClick={() => { onStageItems?.(pending); clearPending() }}
          disabled={pending.length === 0}
        >
          Save
        </Button>

        {pending.length > 0 && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setNaming(true)}>
              Save as draft
            </Button>
            <Button variant="subtle" size="sm" onClick={clearPending}>
              Discard
            </Button>
            <span className="text-[11px] font-semibold text-amber">
              {pending.length} pending change{pending.length > 1 ? 's' : ''}
            </span>
          </>
        )}

        <span className="ml-1 text-[11px] text-ink-faint">{conn.name} · {diagram.tables.length} table(s)</span>

        {/* Right cluster — Tables (show/hide) + Export */}
        <div className="ml-auto flex items-center gap-2">
          <Popover
            align="right"
            width={240}
            trigger={({ open, toggle }) => (
              <Button
                variant="subtle"
                size="sm"
                icon={TableIcon}
                chevron
                active={open}
                onClick={toggle}
                disabled={loading || !augmented.length}
              >
                Tables
              </Button>
            )}
          >
            <div className="p-2">
              <div className="mb-1.5 flex items-center justify-between px-1.5">
                <span className="text-[11px] font-semibold text-ink-dim">Show / hide tables</span>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                  <button type="button" className="text-green hover:text-green-bright" onClick={showAllTables}>
                    All
                  </button>
                  <span className="text-ink-faint">·</span>
                  <button type="button" className="text-ink-dim hover:text-ink" onClick={hideAllTables}>
                    None
                  </button>
                </div>
              </div>
              <input
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Search tables…"
                className="mb-1.5 w-full rounded-soft border border-edge bg-elevated px-2 py-1.5 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-green-dim"
              />
              <div className="max-h-[260px] overflow-y-auto">
                {[...augmented]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .filter((t) => t.name.toLowerCase().includes(tableSearch.trim().toLowerCase()))
                  .map((t) => (
                    <div
                      key={t.name}
                      onClick={() => toggleTable(t.name)}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-[11px] text-ink-dim hover:bg-card-hover hover:text-ink"
                    >
                      <Checkbox checked={!hiddenTables.has(t.name)} onChange={() => toggleTable(t.name)} ariaLabel={`Toggle ${t.name}`} />
                      <span className="truncate">{t.name}</span>
                    </div>
                  ))}
                {augmented.every((t) => !t.name.toLowerCase().includes(tableSearch.trim().toLowerCase())) && (
                  <div className="px-1.5 py-2 text-[11px] text-ink-faint">No tables match.</div>
                )}
              </div>
            </div>
          </Popover>

          <Popover
            align="right"
            width={150}
            trigger={({ open, toggle }) => (
              <Button
                variant="subtle"
                size="sm"
                icon={DownloadIcon}
                chevron
                active={open}
                onClick={toggle}
                disabled={loading || !augmented.length}
              >
                Export
              </Button>
            )}
          >
            {({ close }) => <ExportOptions onExport={(f) => { exportImage(f); close() }} />}
          </Popover>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className="relative min-w-0 flex-1"
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY })
          }}
        >
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-ink-faint">Loading schema…</div>
          ) : augmented.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-ink-faint">
              No tables yet — right-click to create one.
            </div>
          ) : (
            <>
              <ReactFlow
                nodes={nodes}
                edges={edges as any}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes as any}
                onNodesChange={onNodesChange}
                onInit={(inst) => (rf.current = inst)}
                // Dragging shouldn't select a node (which would leave the active
                // green outline stuck on it) — only an explicit click selects.
                selectNodesOnDrag={false}
                onNodeClick={(_, node) => setSelected(node.id)}
                onNodeContextMenu={(e, node) => {
                  e.preventDefault()
                  // Stop the event bubbling to the canvas' onContextMenu, which
                  // would otherwise also open the empty-space menu on top.
                  e.stopPropagation()
                  setMenu(null)
                  setNodeMenu({ x: e.clientX, y: e.clientY, table: node.id, pending: !!node.data?.pending })
                }}
                onEdgeClick={(e, edge) => {
                  setSelectedEdge(edge.id)
                  setEdgePopup({ x: e.clientX, y: e.clientY, fk: edge.data.fk })
                }}
                onEdgeMouseEnter={(_, edge) => setHoveredEdge(edge.id)}
                onEdgeMouseLeave={() => setHoveredEdge(null)}
                onPaneClick={() => {
                  setSelectedEdge(null)
                  setEdgePopup(null)
                }}
                fitView
                proOptions={{ hideAttribution: true }}
              >
                <Background color="var(--color-edge-strong)" gap={18} size={1.6} />
                <MiniMap
                  pannable
                  zoomable
                  style={{ width: 120, height: 84 }}
                  maskColor="rgba(0,0,0,0.55)"
                  nodeColor="#2a352a"
                  nodeStrokeColor="#6fcf6a"
                />
              </ReactFlow>

              {/* Zoom / fit controls — bottom-left of the canvas */}
              <div className="absolute bottom-3 left-3 z-10 flex items-center gap-0.5 rounded-soft border border-edge bg-elevated p-1 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.7)]">
                <button className={ctlBtn} onClick={() => rf.current?.zoomOut()} aria-label="Zoom out">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M5 12h14" />
                  </svg>
                </button>
                <button className={ctlBtn} onClick={() => rf.current?.zoomIn()} aria-label="Zoom in">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
                <button
                  className={ctlBtn}
                  onClick={() => rf.current?.fitView({ duration: 300, padding: 0.2 })}
                  aria-label="Fit view"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {selectedTable && (
        <TableEditPanel
          table={selectedTable}
          dialect={dialect}
          types={types}
          tableNames={tableNames}
          schema={schemaMap}
          foreignKeys={selectedForeignKeys}
          onStage={addPending}
          onClose={() => {
            setSelected(null)
            // Clear ReactFlow's node selection so the active outline doesn't
            // linger on the table after the edit drawer closes.
            setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)))
          }}
        />
      )}

      {creating && (
        <CreateTablePanel conn={conn} onClose={() => setCreating(false)} onStage={addPending} />
      )}

      {naming && (
        <SaveQueryPanel
          title="Save schema draft"
          sql={pending.map((p) => p.sql).join('\n')}
          defaultName={`${conn.name} schema`}
          onClose={() => setNaming(false)}
          onSave={(name) => {
            // Keep the pending changes — saving links this tab to the draft and
            // its items become the draft's working state (handled in Workspace).
            onSaveDraft?.(pending, name)
            setNaming(false)
          }}
        />
      )}

      {/* Foreign-key info popup (shown on edge click) */}
      {edgePopup && (
        <div
          className="fixed z-[60] min-w-[200px] rounded-soft border border-edge-strong bg-elevated px-3 py-2.5 shadow-[0_12px_34px_-10px_rgba(0,0,0,0.75)]"
          style={{ left: Math.min(edgePopup.x, window.innerWidth - 260), top: Math.min(edgePopup.y, window.innerHeight - 110) }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Foreign key</div>
          <div className="font-mono text-[12px] text-ink">
            {edgePopup.fk.table}.{edgePopup.fk.column}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-ink-dim">
            <ChevronRight width={12} height={12} className="text-green" />
            {edgePopup.fk.refTable}.{edgePopup.fk.refColumn}
          </div>
          {(edgePopup.fk.onDelete && edgePopup.fk.onDelete !== 'NO ACTION') ||
          (edgePopup.fk.onUpdate && edgePopup.fk.onUpdate !== 'NO ACTION') ? (
            <div className="mt-2 flex flex-col gap-0.5 border-t border-edge pt-2 text-[10px] text-ink-faint">
              {edgePopup.fk.onDelete && edgePopup.fk.onDelete !== 'NO ACTION' && (
                <span>
                  ON DELETE <span className="font-mono text-ink-dim">{edgePopup.fk.onDelete}</span>
                </span>
              )}
              {edgePopup.fk.onUpdate && edgePopup.fk.onUpdate !== 'NO ACTION' && (
                <span>
                  ON UPDATE <span className="font-mono text-ink-dim">{edgePopup.fk.onUpdate}</span>
                </span>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Table right-click menu */}
      {nodeMenu && (
        <div
          className="fixed z-[60] min-w-[180px] rounded-soft border border-edge-strong bg-elevated p-1 shadow-[0_12px_34px_-10px_rgba(0,0,0,0.75)]"
          style={{ left: Math.min(nodeMenu.x, window.innerWidth - 200), top: Math.min(nodeMenu.y, window.innerHeight - 150) }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="truncate px-2.5 pb-1.5 pt-1 text-[11px] font-semibold text-ink-dim">{nodeMenu.table}</div>
          <button
            className={`${exportItem} disabled:pointer-events-none disabled:opacity-40`}
            disabled={nodeMenu.pending}
            onClick={() => { onOpenTable?.(nodeMenu.table); setNodeMenu(null) }}
          >
            <TableIcon width={14} height={14} /> Open in new tab
          </button>
          <button
            className={`${exportItem} disabled:pointer-events-none disabled:opacity-40`}
            disabled={nodeMenu.pending}
            onClick={() => { onOpenSchema?.(nodeMenu.table); setNodeMenu(null) }}
          >
            <ColumnsIcon width={14} height={14} /> View table schema
          </button>
          <button className={exportItem} onClick={() => { setSelected(nodeMenu.table); setNodeMenu(null) }}>
            <EditIcon width={14} height={14} /> Edit table
          </button>
          <div className="my-1 h-px bg-edge" />
          <button
            className={`${exportItem} !text-red hover:!text-red`}
            onClick={() => { deleteTable(nodeMenu.table, nodeMenu.pending); setNodeMenu(null) }}
          >
            <TrashIcon width={14} height={14} /> Delete table
          </button>
        </div>
      )}

      {/* Canvas right-click menu */}
      {menu && (
        <div
          className="fixed z-[60] min-w-[180px] rounded-soft border border-edge-strong bg-elevated p-1 shadow-[0_12px_34px_-10px_rgba(0,0,0,0.75)]"
          style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 180) }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button className={exportItem} onClick={() => { setCreating(true); setMenu(null) }}>
            <PlusIcon width={14} height={14} /> Create new Table
          </button>
          <div className="group relative">
            <button className={`${exportItem} justify-between`}>
              <span className="flex items-center gap-2">
                <DownloadIcon width={14} height={14} /> Export
              </span>
              <ChevronRight width={13} height={13} />
            </button>
            <div className="absolute left-full top-0 z-10 hidden min-w-[150px] rounded-soft border border-edge-strong bg-elevated shadow-[0_12px_34px_-10px_rgba(0,0,0,0.75)] group-hover:block">
              <ExportOptions onExport={(f) => { exportImage(f); setMenu(null) }} />
            </div>
          </div>
          <button className={exportItem} onClick={() => { autoLayout(); setMenu(null) }}>
            <WandIcon width={14} height={14} /> Auto arrange
          </button>
        </div>
      )}
    </div>
  )
}
