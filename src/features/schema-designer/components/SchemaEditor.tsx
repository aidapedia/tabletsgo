import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  BaseEdge,
  ConnectionMode,
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
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import TextButton from '@/shared/ui/buttons/TextButton'
import Popover from '@/shared/ui/overlay/Popover'
import Checkbox from '@/shared/ui/form/Checkbox'
import Select from '@/shared/ui/form/Select'
import { controlClass } from '@/shared/ui/form/Input'
import { useToast } from '@/shared/ui/feedback/Toast'
import TableEditPanel from '@/features/schema-designer/components/TableEditPanel'
import CreateTablePanel from '@/features/schema-designer/components/CreateTablePanel'
import SaveQueryPanel from '@/shared/ui/SaveQueryPanel'
import { newItemId } from '@/shared/lib/schemaDraft'
import { FK_ACTIONS, fkEligible, normFkAction, useColumnTypes } from '@/features/schema-designer/components/columnFields'
import { useShortcut } from '@/features/keymap'
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
      className={`group relative cursor-pointer rounded-soft border-2 bg-panel text-[11px] shadow-[0_12px_30px_-12px_rgba(0,0,0,0.7)] transition-colors hover:border-green-bright ${
        selected ? 'border-[var(--color-green)]' : data.pending ? 'border-amber' : 'border-edge-strong'
      }`}
    >
      {/* Clips the header/rows to the card's rounded corners. The connect
          dots below render outside this wrapper (not inside it) so they
          aren't cut off where they poke past the card's border. */}
      <div className="overflow-hidden rounded-[8px]">
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
            // Each column can connect from either edge — which end becomes
            // the FK is resolved from which side is the primary key (see
            // resolveFkConnection), not from which handle was grabbed. The
            // drop target is the whole half of the row nearest that edge
            // (not just the dot), so dropping anywhere on the column
            // connects it. SQLite can't alter FKs, so it keeps the old
            // invisible anchor dots instead (both sides, only on
            // already-connected columns).
            const hitClass = '!h-full !min-w-0 !rounded-none !border-0 !bg-transparent !translate-y-0'
            const anchorClass = '!h-1 !w-1 !min-w-0 !border-0 !bg-transparent'
            return (
              <div
                key={c.name}
                // `relative` is required: it's the positioning context for this
                // row's absolute hit-area handles. Without it they'd resolve to
                // the outer card and each span the whole card — so the topmost
                // (last row's) handle would cover every row.
                className="relative flex items-center gap-2 px-3 transition-colors hover:bg-card-hover"
                style={{ height: ROW_H }}
              >
                {data.canEditFk ? (
                  <>
                    {/* Invisible hit areas spanning each half of the row —
                        dropping anywhere here counts as connecting to this column.
                        The visible dot is rendered separately, below, outside the
                        card's clipped wrapper. */}
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={`${c.name}-l`}
                      style={{ top: 0, left: 0, width: '50%' }}
                      className={hitClass}
                    />
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={`${c.name}-r`}
                      style={{ top: 0, right: 0, width: '50%' }}
                      className={hitClass}
                    />
                  </>
                ) : (
                  involved && (
                    <>
                      <Handle type="target" position={Position.Left} id={`${c.name}-l`} style={{ top: rowCenter(i) }} className={anchorClass} />
                      <Handle type="source" position={Position.Right} id={`${c.name}-r`} style={{ top: rowCenter(i) }} className={anchorClass} />
                    </>
                  )
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

      {/* Cardinality badges — rendered outside the clipped wrapper above (as a
          sibling, positioned relative to this outer card) so they aren't cut
          off where they poke past the rounded border; z-index bumped so they
          paint above a neighbouring table card too. Each end of a relationship
          gets a badge on the edge its line lands on — "1" on the referenced
          (PK) column, "N" on the FK column (data.fkSides). 18px badge → −9px
          centres it on the edge. */}
      {data.columns.map((c, i) => {
        const roles = data.fkSides?.[c.name]
        if (!roles) return null
        const badge = 'pointer-events-none absolute z-20 flex h-[18px] w-[18px] -translate-y-1/2 items-center justify-center rounded-full border border-edge-strong bg-elevated text-[10px] font-bold text-ink-dim'
        return (
          <Fragment key={c.name}>
            {roles.l && (
              <div className={`${badge} left-[-9px]`} style={{ top: rowCenter(i) }}>
                {roles.l === 'one' ? '1' : 'N'}
              </div>
            )}
            {roles.r && (
              <div className={`${badge} right-[-9px]`} style={{ top: rowCenter(i) }}>
                {roles.r === 'one' ? '1' : 'N'}
              </div>
            )}
          </Fragment>
        )
      })}
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

// Parse staged FK add/drop SQL (from drag-to-connect diagram edits, or the
// "Foreign key" section of TableEditPanel) so they can be drawn on the
// diagram before they're committed. Returns constraints being added and a
// name -> item id
// map of constraints being dropped (only the local `pending` id is trackable
// for undo — items already pushed to the Changes panel are display-only).
function parsePendingForeignKeys(items) {
  const added = []
  const dropped = new Map() // constraint name -> pending item id (or null once in Changes)
  for (const it of items || []) {
    const sql = it.sql || ''
    let m = sql.match(
      /^\s*ALTER TABLE\s+"([^"]+)"\s+ADD CONSTRAINT\s+"([^"]+)"\s+FOREIGN KEY\s*\("([^"]+)"\)\s+REFERENCES\s+"([^"]+)"\s*\("([^"]+)"\)(?:\s+ON DELETE\s+(\w+(?:\s+\w+)?))?(?:\s+ON UPDATE\s+(\w+(?:\s+\w+)?))?/i
    )
    if (m) {
      added.push({
        itemId: it.id,
        constraint: m[2],
        table: m[1],
        column: m[3],
        refTable: m[4],
        refColumn: m[5],
        onDelete: m[6] || 'NO ACTION',
        onUpdate: m[7] || 'NO ACTION',
      })
      continue
    }
    m = sql.match(/^\s*ALTER TABLE\s+"([^"]+)"\s+DROP CONSTRAINT\s+"([^"]+)"/i)
    if (m) dropped.set(m[2], it.id)
  }
  return { added, dropped }
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
    // Capture the type up to the first modifier / trailing `;` so it doesn't
    // carry the statement terminator (which broke FK type-matching + display).
    m = sql.match(/^\s*ALTER TABLE\s+"([^"]+)"\s+ADD COLUMN\s+"([^"]+)"\s+([^;]+?)\s*(?:\b(?:NOT NULL|PRIMARY KEY|DEFAULT|REFERENCES)\b.*)?;?\s*$/i)
    if (m) (newCols[m[1]] ||= {})[m[2]] = m[3]
  }
  return { newTables, newCols }
}


// Reusable export format list (used by the toolbar dropdown and the canvas menu).
function ExportOptions({ onExport }) {
  return (
    <div className="p-1">
      <MenuItem onClick={() => onExport('png')}>
        <DownloadIcon width={14} height={14} /> PNG image
      </MenuItem>
      <MenuItem onClick={() => onExport('jpg')}>
        <DownloadIcon width={14} height={14} /> JPG image
      </MenuItem>
      <MenuItem onClick={() => onExport('svg')}>
        <DownloadIcon width={14} height={14} /> SVG vector
      </MenuItem>
    </div>
  )
}
const NODE_W = 230 // matches the node style width
const JUMP_R = 5 // hop radius where edges cross
const CORNER_R = 8 // rounded corner radius at turns
const STUB = 22 // straight run out of a table before a same-side line turns

// Live node list, mirrored from state so the top-level connection-line
// component can resolve the table/column under the cursor from raw coordinates
// (React Flow doesn't always report the hovered node/handle during a drag).
const liveNodes = { current: [] as any[] }
const nodeHeight = (n) => HEADER_H + PAD_T * 2 + (n.data?.columns?.length || 0) * ROW_H
// The table column at flow-coords (x, y), or null — used to snap the drag
// preview to whatever column the cursor is over, excluding the drag's origin.
function columnAt(x, y, exceptId) {
  for (const n of liveNodes.current) {
    if (n.id === exceptId) continue
    if (x < n.position.x || x > n.position.x + NODE_W) continue
    if (y < n.position.y || y > n.position.y + nodeHeight(n)) continue
    const row = Math.floor((y - n.position.y - HEADER_H - PAD_T) / ROW_H)
    if (row >= 0 && row < n.data.columns.length) return { node: n, index: row }
  }
  return null
}

// Custom edge: just the pre-computed rounded path. Endpoints are marked by
// cardinality badges (1 / N) rendered on the table nodes (see TableNode), which
// paint above the cards; drawing dots here would sit behind the cards.
function FkEdge({ data, style, markerEnd }) {
  return <BaseEdge path={data.path} style={style} markerEnd={markerEnd} />
}
const edgeTypes = { fk: FkEdge }

// Which side (+1 right / -1 left) each table's endpoint leaves from, so the
// line faces the other table instead of doubling back across it. When the two
// tables overlap horizontally (e.g. stacked vertically) both leave the same
// side and the line bulges out and around — never backtracking over a card.
function pickSides(sPos, tPos) {
  const scx = sPos.x + NODE_W / 2
  const tcx = tPos.x + NODE_W / 2
  if (tcx >= scx + NODE_W) return { sDir: 1, tDir: -1 } // target clearly to the right
  if (tcx <= scx - NODE_W) return { sDir: -1, tDir: 1 } // target clearly to the left
  const dir = tcx >= scx ? 1 : -1 // overlapping — both exit the same side
  return { sDir: dir, tDir: dir }
}

// Orthogonal route from a source point leaving toward sDir to a target point
// leaving toward tDir. Facing sides get a vertical run at the midpoint;
// same-side endpoints bulge out past whichever card sticks out furthest.
function routePoints(sx, sy, sDir, tx, ty, tDir) {
  if (sDir !== tDir) {
    const midX = (sx + tx) / 2
    return [
      { x: sx, y: sy },
      { x: midX, y: sy },
      { x: midX, y: ty },
      { x: tx, y: ty },
    ]
  }
  const outX = sDir > 0 ? Math.max(sx, tx) + STUB : Math.min(sx, tx) - STUB
  return [
    { x: sx, y: sy },
    { x: outX, y: sy },
    { x: outX, y: ty },
    { x: tx, y: ty },
  ]
}

// In-progress connection preview (while dragging from a column's dot). Anchors
// at the source column's exact edge dot (not the big drop-handle's centre, so
// the line reads as coming from the dot). While the cursor is over a valid
// target column it snaps its far end to that column's dot and routes exactly
// like the committed edge will; otherwise it trails the cursor. Uses the same
// orthogonal routing as committed edges, not React Flow's default bezier.
function FkConnectionLine({ fromNode, fromHandle, toX, toY, toNode, toHandle }) {
  const cols = fromNode?.data?.columns || []
  const name = (fromHandle?.id || '').replace(/-[lr]$/, '')
  const si = cols.findIndex((c) => c.name === name)
  if (si < 0) return null

  // Target column under the cursor, so we can snap to it. Prefer the node
  // React Flow reports; otherwise resolve it from the raw cursor coords
  // (columnAt) so hovering anywhere over a column still snaps to that column.
  let tNode = toNode
  const tName = (toHandle?.id || '').replace(/-[lr]$/, '')
  let ti = tNode && tName ? tNode.data.columns.findIndex((c) => c.name === tName) : -1
  if (ti < 0) {
    const hit = columnAt(toX, toY, fromNode.id)
    if (hit) {
      tNode = hit.node
      ti = hit.index
    }
  }

  let points
  let end
  if (ti >= 0 && tNode) {
    // Snapped: the source dot stays on the edge the drag was grabbed from; the
    // target dot lands on whichever edge the cursor is nearer (its half of the
    // target column), so the user chooses the attach side by where they hover.
    const sDir = fromHandle.id.endsWith('-r') ? 1 : -1
    const tDir = toX < tNode.position.x + NODE_W / 2 ? -1 : 1
    const sx = fromNode.position.x + (sDir > 0 ? NODE_W : 0)
    const sy = fromNode.position.y + rowCenter(si)
    const tx = tNode.position.x + (tDir > 0 ? NODE_W : 0)
    const ty = tNode.position.y + rowCenter(ti)
    points = routePoints(sx, sy, sDir, tx, ty, tDir)
    end = { x: tx, y: ty }
  } else {
    // Free: anchor at the source dot, trail the cursor.
    const sDir = fromHandle.id.endsWith('-r') ? 1 : -1
    const sx = fromNode.position.x + (sDir > 0 ? NODE_W : 0)
    const sy = fromNode.position.y + rowCenter(si)
    const tDir = toX >= sx ? -1 : 1
    points = routePoints(sx, sy, sDir, toX, toY, tDir)
    end = null
  }

  return (
    <g>
      <path fill="none" stroke="var(--color-amber)" strokeWidth={1.5} strokeDasharray="4 3" d={pathWithJumps(points, [])} />
      {/* Solid dot at the source column, and — when snapped — a solid dot at the
          target column's edge, so the line reads as attached to a dot on both. */}
      <circle cx={points[0].x} cy={points[0].y} r={5} fill="var(--color-amber)" />
      {end && (
        <>
          <circle cx={end.x} cy={end.y} r={6} fill="none" stroke="var(--color-amber)" strokeWidth={2} opacity={0.5} />
          <circle cx={end.x} cy={end.y} r={5} fill="var(--color-amber)" />
        </>
      )}
    </g>
  )
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
  const toast = useToast()

  const [diagram, setDiagram] = useState({ tables: [], foreignKeys: [] })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null) // table name being edited
  const [selectedEdge, setSelectedEdge] = useState(null) // clicked FK edge id
  const [hoveredEdge, setHoveredEdge] = useState(null) // FK edge under the cursor
  const [edgePopup, setEdgePopup] = useState(null) // { x, y, fk } — FK info popup
  const [fkEdit, setFkEdit] = useState(null) // { onDelete, onUpdate } — editing a committed FK's actions
  const [fkConfirm, setFkConfirm] = useState(null) // { x, y, fkTable, fkCol, pkTable, pkCol, name, onDelete, onUpdate } — new drag-to-connect FK, pending confirmation
  const [hiddenTables, setHiddenTables] = useState(() => new Set()) // tables hidden from the diagram
  const [tableSearch, setTableSearch] = useState('') // filter for the show/hide list
  const [menu, setMenu] = useState(null) // canvas context menu { x, y }
  const [nodeMenu, setNodeMenu] = useState(null) // table right-click menu { x, y, table, pending }
  const [creating, setCreating] = useState(false) // create-table panel open
  const [naming, setNaming] = useState(false) // "save as draft" name prompt open
  const canEditFk = dialect === 'postgresql' // drag-to-connect FK editing (SQLite can't alter FKs)

  // Pending changes are owned by the workspace (per tab) so they survive tab
  // switches; the panels hand their statements up via onPendingChange. Each
  // entry in `statements` is either a plain SQL string (uses the shared
  // `rollbackSql` arg) or a `{ sql, rollbackSql }` pair for batches where
  // each statement needs its own rollback (e.g. a FK drop-then-re-add).
  const addPending = (statements, tableName, mode, rollbackSql = undefined) =>
    onPendingChange?.([
      ...pending,
      ...statements.map((s) =>
        typeof s === 'string'
          ? { id: newItemId(), sql: s, table: tableName, mode, rollbackSql }
          : { id: newItemId(), sql: s.sql, table: tableName, mode, rollbackSql: s.rollbackSql }
      ),
    ])
  const clearPending = () => onPendingChange?.([])
  const removePendingItem = (itemId) => onPendingChange?.(pending.filter((p) => p.id !== itemId))

  // Delete a table: a pending (uncommitted) table just drops its staged
  // statements; an existing table stages a DROP TABLE for the next commit.
  const deleteTable = (table, isPending) => {
    if (isPending) onPendingChange?.(pending.filter((p) => p.table !== table))
    else addPending([`DROP TABLE "${table}";`], table, 'delete')
  }

  // Reconstruct a committed FK's ADD CONSTRAINT statement (optionally with
  // different actions) — used both as a drop's rollback and to re-add the
  // constraint when editing its ON DELETE / ON UPDATE actions.
  const fkAddSql = (fk, onDelete = fk.onDelete, onUpdate = fk.onUpdate) => {
    let s = `ALTER TABLE "${fk.table}" ADD CONSTRAINT "${fk.constraint}" FOREIGN KEY ("${fk.column}") REFERENCES "${fk.refTable}"("${fk.refColumn}")`
    if (onDelete && onDelete !== 'NO ACTION') s += ` ON DELETE ${onDelete}`
    if (onUpdate && onUpdate !== 'NO ACTION') s += ` ON UPDATE ${onUpdate}`
    return s + ';'
  }

  // Stage dropping a committed FK constraint; rollback re-adds it unchanged.
  const deleteFk = (fk) => {
    addPending([`ALTER TABLE "${fk.table}" DROP CONSTRAINT "${fk.constraint}";`], fk.table, 'fk-drop', fkAddSql(fk))
    setEdgePopup(null)
    setSelectedEdge(null)
    setFkEdit(null)
  }

  // Stage a committed FK's ON DELETE / ON UPDATE change. Postgres can't alter
  // a FK's actions in place, so drop the old constraint and re-add it with
  // the new actions — each statement carries its own rollback so the pair
  // reverses cleanly in either order.
  const saveFkActions = (fk) => {
    addPending(
      [
        { sql: `ALTER TABLE "${fk.table}" DROP CONSTRAINT "${fk.constraint}";`, rollbackSql: fkAddSql(fk) },
        { sql: fkAddSql(fk, fkEdit.onDelete, fkEdit.onUpdate), rollbackSql: `ALTER TABLE "${fk.table}" DROP CONSTRAINT "${fk.constraint}";` },
      ],
      fk.table,
      'fk-edit'
    )
    setEdgePopup(null)
    setSelectedEdge(null)
    setFkEdit(null)
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

  // Committed foreign keys plus any staged FK add/drop (from drag-to-connect
  // diagram edits or TableEditPanel), so the diagram reflects uncommitted FK
  // edits too. Only
  // adds/drops still in local `pending` carry an undo-able item id — ones
  // already pushed to the Changes panel are shown but not editable here.
  const augmentedForeignKeys = useMemo(() => {
    const { added: addedPending, dropped: droppedPending } = parsePendingForeignKeys(pending)
    const { added: addedChanges, dropped: droppedChanges } = parsePendingForeignKeys(changes)
    const base = diagram.foreignKeys.map((fk) => ({
      ...fk,
      removed: !!(fk.constraint && (droppedPending.has(fk.constraint) || droppedChanges.has(fk.constraint))),
      removeItemId: fk.constraint ? droppedPending.get(fk.constraint) ?? null : null,
    }))
    const added = [
      ...addedChanges.map((fk) => ({ ...fk, pendingFk: true, itemId: null })),
      ...addedPending.map((fk) => ({ ...fk, pendingFk: true })),
    ]
    return [...base, ...added]
  }, [diagram, pending, changes])

  // Per-table FK endpoints: source columns (this table's FKs) and target
  // columns (referenced by other tables) — used to place column handles.
  const fkInfo = useMemo(() => {
    const src = {}
    const tgt = {}
    for (const fk of augmentedForeignKeys) {
      ;(src[fk.table] ||= new Set()).add(fk.column)
      ;(tgt[fk.refTable] ||= new Set()).add(fk.refColumn)
    }
    return { src, tgt }
  }, [augmentedForeignKeys])

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
  // Mirror live node positions for the connection-line component's cursor
  // hit-testing (columnAt). onNodesChange updates positions during node drags
  // too, so keep it in sync on every nodes change.
  liveNodes.current = nodes
  const rf = useRef(null)
  // Set by onConnect right before onConnectEnd fires for the same gesture —
  // lets onConnectEnd (which has the mouse position) open the confirm modal.
  const pendingConnectRef = useRef(null)

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
          canEditFk,
        },
      }
    })
  }, [augmented, diagram, fkInfo, hiddenTables, canEditFk])

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

    // Endpoint + raw orthogonal points for each FK (committed + staged).
    const raw = []
    augmentedForeignKeys.forEach((fk, i) => {
      const sn = byId[fk.table]
      const tn = byId[fk.refTable]
      if (!sn || !tn) return
      const si = sn.data.columns.findIndex((c) => c.name === fk.column)
      const ti = tn.data.columns.findIndex((c) => c.name === fk.refColumn)
      if (si < 0 || ti < 0) return
      // Pick each table's exit side so the line faces the other card without
      // doubling back, then route orthogonally between the two edge points.
      const { sDir, tDir } = pickSides(sn.position, tn.position)
      const sx = sn.position.x + (sDir > 0 ? NODE_W : 0)
      const tx = tn.position.x + (tDir > 0 ? NODE_W : 0)
      const points = routePoints(sx, sn.position.y + rowCenter(si), sDir, tx, tn.position.y + rowCenter(ti), tDir)
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
  }, [nodes, augmentedForeignKeys])

  // Which edge (left/right) each connected column's line lands on, plus its
  // cardinality role — the referenced (PK) column is the "one" side, the FK
  // column the "many" side — using the same side-picking as the routing. Fed
  // into node data so the node can render a cardinality badge (1 / N) exactly
  // where the line attaches. Shape: table -> { column -> { l|r: 'one'|'many' } }.
  const fkEndpoints = useMemo(() => {
    const byId = {}
    for (const n of nodes) byId[n.id] = n
    const map = {}
    const add = (t, c, side, role) => {
      const col = ((map[t] ||= {})[c] ||= {})
      // A FK ("many") should win over an incidental "one" if a column is both.
      if (col[side] !== 'many') col[side] = role
    }
    for (const fk of augmentedForeignKeys) {
      if (fk.removed) continue
      const sn = byId[fk.table]
      const tn = byId[fk.refTable]
      if (!sn || !tn) continue
      const { sDir, tDir } = pickSides(sn.position, tn.position)
      add(fk.table, fk.column, sDir > 0 ? 'r' : 'l', 'many')
      add(fk.refTable, fk.refColumn, tDir > 0 ? 'r' : 'l', 'one')
    }
    return map
  }, [nodes, augmentedForeignKeys])

  // Apply theme colour + selection state without recomputing the routed paths.
  // FK lines use the ink colour (white on dark, black on light); the selected
  // edge animates (marching dots) and highlights green. Staged FK adds render
  // amber (matches the "staged" table/column styling); staged drops render
  // faint + dashed to read as "about to be removed".
  const edges = useMemo(
    () =>
      baseEdges.map((e) => {
        const isSel = e.id === selectedEdge
        const isHover = !isSel && e.id === hoveredEdge
        const active = isSel || isHover
        const { pendingFk, removed } = e.data.fk
        const baseColor = removed ? 'var(--color-ink-faint)' : pendingFk ? 'var(--color-amber)' : 'var(--color-ink)'
        return {
          ...e,
          animated: isSel, // drives React Flow's marching-ants animation
          style: {
            stroke: active ? 'var(--color-green)' : baseColor,
            strokeWidth: active ? 2 : 1.5,
            opacity: removed ? 0.5 : 1,
            // Round dotted pattern so the animation reads as "moving dots";
            // staged (pending/removed) edges get a plain dash instead.
            ...(isSel
              ? { strokeDasharray: '0.1 6', strokeLinecap: 'round' }
              : pendingFk || removed
                ? { strokeDasharray: '4 3' }
                : {}),
          },
        }
      }),
    [baseEdges, selectedEdge, hoveredEdge]
  )

  // While the confirm modal is open the FK isn't staged yet, so bridge the gap
  // between drop and "Add" by drawing a preview edge between the two columns —
  // the connection stays visible the whole time (matches the dropped line).
  const edgesWithPreview = useMemo(() => {
    if (!fkConfirm) return edges
    const byId = {}
    for (const n of nodes) byId[n.id] = n
    const sn = byId[fkConfirm.fkTable]
    const tn = byId[fkConfirm.pkTable]
    if (!sn || !tn) return edges
    const si = sn.data.columns.findIndex((c) => c.name === fkConfirm.fkCol)
    const ti = tn.data.columns.findIndex((c) => c.name === fkConfirm.pkCol)
    if (si < 0 || ti < 0) return edges
    const { sDir, tDir } = pickSides(sn.position, tn.position)
    const sx = sn.position.x + (sDir > 0 ? NODE_W : 0)
    const tx = tn.position.x + (tDir > 0 ? NODE_W : 0)
    const points = routePoints(sx, sn.position.y + rowCenter(si), sDir, tx, tn.position.y + rowCenter(ti), tDir)
    return [
      ...edges,
      {
        id: 'fk-confirm-preview',
        source: fkConfirm.fkTable,
        target: fkConfirm.pkTable,
        type: 'fk',
        style: { stroke: 'var(--color-green)', strokeWidth: 2, strokeDasharray: '4 3' },
        data: { fk: {}, path: pathWithJumps(points, []), start: points[0], end: points[points.length - 1] },
      },
    ]
  }, [edges, fkConfirm, nodes])

  // Inject each table's connection endpoints into node data (without re-running
  // dagre), so a connected column can paint a solid dot on the exact edge its
  // line lands on. Kept off `layoutNodes` so it never reshuffles the diagram.
  const displayNodes = useMemo(
    () => nodes.map((n) => (n.data.fkSides === fkEndpoints[n.id] ? n : { ...n, data: { ...n.data, fkSides: fkEndpoints[n.id] } })),
    [nodes, fkEndpoints]
  )

  // Whether a column already carries a live (not staged-for-removal) FK —
  // used to stop a second connection from being drawn off the same column.
  const columnHasFk = useCallback(
    (table, col) => augmentedForeignKeys.some((fk) => !fk.removed && fk.table === table && fk.column === col),
    [augmentedForeignKeys]
  )

  // A drag can start from either end (loose connection mode) and either dot
  // on a column — so `conn.source`/`conn.target` just say which end the drag
  // started/ended on, not which one is the FK. Resolve that from whichever
  // side is the primary key: PK side is referenced, the other side becomes
  // the FK column. Ambiguous (both or neither PK) connections are rejected.
  const resolveFkConnection = useCallback(
    (conn) => {
      if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle) return null
      const srcNode = nodes.find((n) => n.id === conn.source)
      const tgtNode = nodes.find((n) => n.id === conn.target)
      const srcCol = srcNode?.data.columns.find((c) => conn.sourceHandle === `${c.name}-l` || conn.sourceHandle === `${c.name}-r`)
      const tgtCol = tgtNode?.data.columns.find((c) => conn.targetHandle === `${c.name}-l` || conn.targetHandle === `${c.name}-r`)
      if (!srcCol || !tgtCol || srcCol.pk === tgtCol.pk) return null
      return srcCol.pk
        ? { pkTable: conn.source, pkCol: srcCol, fkTable: conn.target, fkCol: tgtCol }
        : { pkTable: conn.target, pkCol: tgtCol, fkTable: conn.source, fkCol: srcCol }
    },
    [nodes]
  )

  const isValidConnection = useCallback(
    (conn) => {
      if (!canEditFk) return false
      const resolved = resolveFkConnection(conn)
      if (!resolved) return false
      const { fkTable, fkCol, pkTable, pkCol } = resolved
      if (!fkEligible(fkTable, fkCol, pkTable, pkCol)) return false
      return !columnHasFk(fkTable, fkCol.name)
    },
    [canEditFk, resolveFkConnection, columnHasFk]
  )

  // A valid drag (already passed isValidConnection) doesn't stage anything
  // by itself — it stashes the resolved FK for onConnectEnd, which fires
  // right after with the mouse position, to open the confirm modal there.
  const onConnect = useCallback(
    (conn) => {
      const resolved = resolveFkConnection(conn)
      if (!resolved || columnHasFk(resolved.fkTable, resolved.fkCol.name)) return
      pendingConnectRef.current = resolved
    },
    [resolveFkConnection, columnHasFk]
  )

  // Fires after every connection attempt, valid or not. A stashed resolution
  // means onConnect just succeeded — open the name/actions confirm modal at
  // the drop point. Otherwise, if the drag was released on another handle
  // (not empty canvas), it was a genuine invalid attempt.
  const onConnectEnd = useCallback(
    (event) => {
      const resolved = pendingConnectRef.current
      pendingConnectRef.current = null
      const point = event.changedTouches?.[0] ?? event
      if (resolved) {
        const { fkTable, fkCol, pkTable, pkCol } = resolved
        setFkConfirm({
          x: point.clientX,
          y: point.clientY,
          fkTable,
          fkCol: fkCol.name,
          pkTable,
          pkCol: pkCol.name,
          name: `${fkTable}_${fkCol.name}_fkey`,
          onDelete: '',
          onUpdate: '',
        })
        return
      }
      if (event.target?.closest?.('.react-flow__handle')) {
        toast.error('Invalid foreign key — the columns must share a type and the target must be a primary key.')
      }
    },
    [toast]
  )

  // Stage the confirmed FK from the drag-to-connect modal.
  const confirmFk = () => {
    if (!fkConfirm) return
    const { fkTable, fkCol, pkTable, pkCol, onDelete, onUpdate } = fkConfirm
    const constraint = fkConfirm.name.trim() || `${fkTable}_${fkCol}_fkey`
    let sql = `ALTER TABLE "${fkTable}" ADD CONSTRAINT "${constraint}" FOREIGN KEY ("${fkCol}") REFERENCES "${pkTable}"("${pkCol}")`
    if (onDelete) sql += ` ON DELETE ${onDelete}`
    if (onUpdate) sql += ` ON UPDATE ${onUpdate}`
    addPending([sql + ';'], fkTable, 'fk-add', `ALTER TABLE "${fkTable}" DROP CONSTRAINT "${constraint}";`)
    setFkConfirm(null)
  }

  const autoLayout = () => {
    setNodes(layoutNodes())
    setTimeout(() => rf.current?.fitView({ duration: 300, padding: 0.2 }), 0)
  }

  useShortcut('schema.createTable', () => setCreating(true))
  useShortcut('schema.autoLayout', autoLayout)

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

  // Open the edit panel against the *augmented* schema (committed + not-yet-
  // committed columns) so uncommitted changes are reflected in the form.
  // Restricted to committed tables (a pending brand-new table is created via
  // the create-table panel, not ALTERed).
  const selectedTable = selected ? augmented.find((t) => t.name === selected && !t.pending) : null
  // Foreign keys on the selected table, including staged adds (and excluding
  // staged drops), so the form's FK section matches the diagram.
  const selectedForeignKeys = selected ? augmentedForeignKeys.filter((fk) => fk.table === selected && !fk.removed) : []

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
      setFkEdit(null)
    }
    const onKey = (e) => e.key === 'Escape' && close()
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [edgePopup])

  // Dismiss the new-FK confirm modal on Escape / resize (without staging it).
  useEffect(() => {
    if (!fkConfirm) return
    const close = () => setFkConfirm(null)
    const onKey = (e) => e.key === 'Escape' && close()
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [fkConfirm])

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
                  <TextButton tone="green" className="!text-[11px]" onClick={showAllTables}>
                    All
                  </TextButton>
                  <span className="text-ink-faint">·</span>
                  <TextButton className="!text-[11px]" onClick={hideAllTables}>
                    None
                  </TextButton>
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
                nodes={displayNodes}
                edges={edgesWithPreview as any}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes as any}
                connectionLineComponent={FkConnectionLine as any}
                connectionMode={ConnectionMode.Loose}
                onNodesChange={onNodesChange}
                onInit={(inst) => (rf.current = inst)}
                // Dragging shouldn't select a node (which would leave the active
                // green outline stuck on it) — only an explicit click selects.
                selectNodesOnDrag={false}
                isValidConnection={isValidConnection}
                onConnect={onConnect}
                onConnectEnd={onConnectEnd}
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
                  const fk = edge.data.fk
                  setSelectedEdge(edge.id)
                  setEdgePopup({ x: e.clientX, y: e.clientY, fk })
                  // Only a committed, not-already-staged FK can have its
                  // actions edited here (a staged add/drop is edited by
                  // undoing it and redrawing/re-deleting instead).
                  setFkEdit(
                    canEditFk && fk.constraint && !fk.pendingFk && !fk.removed
                      ? { onDelete: normFkAction(fk.onDelete), onUpdate: normFkAction(fk.onUpdate) }
                      : null
                  )
                }}
                onEdgeMouseEnter={(_, edge) => setHoveredEdge(edge.id)}
                onEdgeMouseLeave={() => setHoveredEdge(null)}
                onPaneClick={() => {
                  setSelectedEdge(null)
                  setEdgePopup(null)
                  setFkEdit(null)
                  setFkConfirm(null)
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
                <IconButton onClick={() => rf.current?.zoomOut()} aria-label="Zoom out">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M5 12h14" />
                  </svg>
                </IconButton>
                <IconButton onClick={() => rf.current?.zoomIn()} aria-label="Zoom in">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </IconButton>
                <IconButton onClick={() => rf.current?.fitView({ duration: 300, padding: 0.2 })} aria-label="Fit view">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                </IconButton>
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

      {/* Foreign-key info popup (shown on edge click) — for Postgres a
          committed FK gets delete + ON DELETE/UPDATE editing; a staged
          add/drop shows its pending status with an undo, when undoable. */}
      {edgePopup && (
        <div
          className="fixed z-[60] min-w-[200px] rounded-soft border border-edge-strong bg-elevated px-3 py-2.5 shadow-[0_12px_34px_-10px_rgba(0,0,0,0.75)]"
          style={{ left: Math.min(edgePopup.x, window.innerWidth - 260), top: Math.min(edgePopup.y, window.innerHeight - 150) }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Foreign key</span>
            {edgePopup.fk.pendingFk && (
              <span className="rounded bg-amber/20 px-1 text-[9px] font-bold uppercase tracking-wide text-amber">staged add</span>
            )}
            {edgePopup.fk.removed && (
              <span className="rounded bg-ink-faint/20 px-1 text-[9px] font-bold uppercase tracking-wide text-ink-faint">staged drop</span>
            )}
          </div>
          <div className="font-mono text-[12px] text-ink">
            {edgePopup.fk.table}.{edgePopup.fk.column}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-ink-dim">
            <ChevronRight width={12} height={12} className="text-green" />
            {edgePopup.fk.refTable}.{edgePopup.fk.refColumn}
          </div>

          {fkEdit ? (
            <div className="mt-2 flex flex-col gap-1.5 border-t border-edge pt-2">
              <div className="flex items-center gap-2">
                <span className="w-[70px] shrink-0 text-[11px] text-ink-faint">On delete</span>
                <Select
                  className={`${controlClass} !w-auto min-w-0 flex-1`}
                  value={fkEdit.onDelete}
                  onChange={(v) => setFkEdit((s) => ({ ...s, onDelete: v }))}
                  options={FK_ACTIONS}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-[70px] shrink-0 text-[11px] text-ink-faint">On update</span>
                <Select
                  className={`${controlClass} !w-auto min-w-0 flex-1`}
                  value={fkEdit.onUpdate}
                  onChange={(v) => setFkEdit((s) => ({ ...s, onUpdate: v }))}
                  options={FK_ACTIONS}
                />
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <TextButton className="!text-[11px] font-semibold hover:!text-red" onClick={() => deleteFk(edgePopup.fk)}>
                  <TrashIcon width={13} height={13} /> Delete
                </TextButton>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={fkEdit.onDelete === normFkAction(edgePopup.fk.onDelete) && fkEdit.onUpdate === normFkAction(edgePopup.fk.onUpdate)}
                  onClick={() => saveFkActions(edgePopup.fk)}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <>
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

              {canEditFk && (edgePopup.fk.pendingFk || edgePopup.fk.removed) && (
                <div className="mt-2 border-t border-edge pt-2">
                  {edgePopup.fk.itemId || edgePopup.fk.removeItemId ? (
                    <TextButton
                      className="!text-[11px] font-semibold"
                      onClick={() => {
                        removePendingItem(edgePopup.fk.itemId || edgePopup.fk.removeItemId)
                        setEdgePopup(null)
                        setSelectedEdge(null)
                      }}
                    >
                      Undo
                    </TextButton>
                  ) : (
                    <span className="text-[11px] text-ink-faint">Already staged in Changes.</span>
                  )}
                </div>
              )}

              {canEditFk && !edgePopup.fk.pendingFk && !edgePopup.fk.removed && edgePopup.fk.constraint && (
                <div className="mt-2 border-t border-edge pt-2">
                  <TextButton className="!text-[11px] font-semibold hover:!text-red" onClick={() => deleteFk(edgePopup.fk)}>
                    <TrashIcon width={13} height={13} /> Delete foreign key
                  </TextButton>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* New-FK confirm modal (shown after a valid drag-to-connect drop) —
          name the constraint (defaulted) and set its actions before staging. */}
      {fkConfirm && (
        <div
          className="fixed z-[60] min-w-[240px] rounded-soft border border-edge-strong bg-elevated px-3 py-2.5 shadow-[0_12px_34px_-10px_rgba(0,0,0,0.75)]"
          style={{ left: Math.min(fkConfirm.x, window.innerWidth - 300), top: Math.min(fkConfirm.y, window.innerHeight - 260) }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">New foreign key</div>
          <div className="font-mono text-[12px] text-ink">
            {fkConfirm.fkTable}.{fkConfirm.fkCol}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-ink-dim">
            <ChevronRight width={12} height={12} className="text-green" />
            {fkConfirm.pkTable}.{fkConfirm.pkCol}
          </div>

          <div className="mt-2 flex flex-col gap-1.5 border-t border-edge pt-2">
            <div className="flex items-center gap-2">
              <span className="w-[70px] shrink-0 text-[11px] text-ink-faint">Name</span>
              <input
                className={`${controlClass} !w-auto min-w-0 flex-1`}
                value={fkConfirm.name}
                onChange={(e) => setFkConfirm((s) => ({ ...s, name: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-[70px] shrink-0 text-[11px] text-ink-faint">On delete</span>
              <Select
                className={`${controlClass} !w-auto min-w-0 flex-1`}
                value={fkConfirm.onDelete}
                onChange={(v) => setFkConfirm((s) => ({ ...s, onDelete: v }))}
                options={FK_ACTIONS}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-[70px] shrink-0 text-[11px] text-ink-faint">On update</span>
              <Select
                className={`${controlClass} !w-auto min-w-0 flex-1`}
                value={fkConfirm.onUpdate}
                onChange={(v) => setFkConfirm((s) => ({ ...s, onUpdate: v }))}
                options={FK_ACTIONS}
              />
            </div>
            <div className="mt-1 flex items-center justify-end gap-2">
              <Button variant="subtle" size="sm" onClick={() => setFkConfirm(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" disabled={!fkConfirm.name.trim()} onClick={confirmFk}>
                Add
              </Button>
            </div>
          </div>
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
          <MenuItem disabled={nodeMenu.pending} onClick={() => { onOpenTable?.(nodeMenu.table); setNodeMenu(null) }}>
            <TableIcon width={14} height={14} /> Open in new tab
          </MenuItem>
          <MenuItem disabled={nodeMenu.pending} onClick={() => { onOpenSchema?.(nodeMenu.table); setNodeMenu(null) }}>
            <ColumnsIcon width={14} height={14} /> View table schema
          </MenuItem>
          <MenuItem onClick={() => { setSelected(nodeMenu.table); setNodeMenu(null) }}>
            <EditIcon width={14} height={14} /> Edit table
          </MenuItem>
          <div className="my-1 h-px bg-edge" />
          <MenuItem danger className="!text-red" onClick={() => { deleteTable(nodeMenu.table, nodeMenu.pending); setNodeMenu(null) }}>
            <TrashIcon width={14} height={14} /> Delete table
          </MenuItem>
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
          <MenuItem onClick={() => { setCreating(true); setMenu(null) }}>
            <PlusIcon width={14} height={14} /> Create new Table
          </MenuItem>
          <div className="group relative">
            <MenuItem className="justify-between">
              <span className="flex items-center gap-2">
                <DownloadIcon width={14} height={14} /> Export
              </span>
              <ChevronRight width={13} height={13} />
            </MenuItem>
            <div className="absolute left-full top-0 z-10 hidden min-w-[150px] rounded-soft border border-edge-strong bg-elevated shadow-[0_12px_34px_-10px_rgba(0,0,0,0.75)] group-hover:block">
              <ExportOptions onExport={(f) => { exportImage(f); setMenu(null) }} />
            </div>
          </div>
          <MenuItem onClick={() => { autoLayout(); setMenu(null) }}>
            <WandIcon width={14} height={14} /> Auto arrange
          </MenuItem>
        </div>
      )}
    </div>
  )
}
