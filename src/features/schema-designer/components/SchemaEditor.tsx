import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  BaseEdge,
  ConnectionMode,
  getRectOfNodes,
  getTransformForBounds,
  Handle,
  MiniMap,
  NodeResizer,
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
import ContextMenu, { ContextMenuSub } from '@/shared/ui/overlay/ContextMenu'
import Badge from '@/shared/ui/Badge'
import Select from '@/shared/ui/form/Select'
import { controlClass, Input } from '@/shared/ui/form/Input'
import { useToast } from '@/shared/ui/feedback/Toast'
import TableEditPanel from '@/features/schema-designer/components/TableEditPanel'
import CreateTablePanel from '@/features/schema-designer/components/CreateTablePanel'
import SchemaSidebar from '@/features/schema-designer/components/SchemaSidebar'
import ReleaseDialog from '@/features/schema-designer/components/ReleaseDialog'
import SaveQueryPanel from '@/shared/ui/SaveQueryPanel'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { draftToItems, newItemId } from '@/shared/lib/schemaDraft'
import {
  buildDesignDoc,
  designFileName,
  emptyLayout,
  LAYOUT_VERSION,
  newNoteId,
  NOTE_COLORS,
  NOTE_DEFAULT_COLOR,
  NOTE_DEFAULT_H,
  NOTE_DEFAULT_W,
  NOTE_MIN_H,
  NOTE_MIN_W,
  normalizeLayout,
  parseDesignDoc,
  type SchemaDesignDoc,
  type SchemaLayout,
  type SchemaNote,
} from '@/features/schema-designer/lib/design'
import { TableFolderEditPanel } from '@/features/table-folders'
import { columnTypeSql, FK_ACTIONS, fkEligible, normFkAction, parseColumnDefs, useColumnTypes } from '@/features/schema-designer/components/columnFields'
import { useShortcut } from '@/features/keymap'
import { ChevronRight, ColumnsIcon, DownloadIcon, EditIcon, FolderIcon, NoteIcon, PlayIcon, PlusIcon, SaveIcon, TableIcon, TagIcon, TrashIcon, UploadIcon, WandIcon } from '@/shared/ui/icons'

// Fixed metrics so per-column handles line up with their rows.
const HEADER_H = 34
const ROW_H = 22
const PAD_T = 4
const rowCenter = (i) => HEADER_H + PAD_T + i * ROW_H + ROW_H / 2

// ---- Custom node: a table with per-column FK handles ----
function TableNode({ data, selected }) {
  // Staged-but-uncommitted state is colour-coded to mirror the Changes panel
  // (add = green, alter = amber, drop = red): a newly-created table is green
  // ("new"); a table staged for DROP is red + struck through ("dropped").
  return (
    <div
      className={`group relative cursor-pointer rounded-soft border-2 bg-panel text-[11px] transition-colors hover:border-green-bright ${
        selected ? 'border-[var(--color-green)]' : data.dropped ? 'border-red' : data.pending ? 'border-green' : 'border-edge-strong'
      } ${data.dropped ? 'opacity-70' : ''}`}
    >
      {/* Clips the header/rows to the card's rounded corners. The connect
          dots below render outside this wrapper (not inside it) so they
          aren't cut off where they poke past the card's border. */}
      <div className="overflow-hidden rounded-[8px]">
        <div
          className={`flex items-center gap-2 border-b px-3 text-[12px] font-bold ${
            data.dropped
              ? 'border-red/40 bg-red/20 text-red'
              : data.pending
                ? 'border-green/40 bg-green/20 text-green-bright'
                : 'border-edge bg-elevated text-ink'
          }`}
          style={{ height: HEADER_H }}
        >
          <span className={`min-w-0 flex-1 truncate ${data.dropped ? 'line-through' : ''}`}>{data.name}</span>
          {data.dropped ? <Badge tone="red" dense>dropped</Badge> : data.pending && <Badge tone="green" dense>new</Badge>}
          {/* Edit affordance — revealed on hover; click opens the table editor
              (detected via `.table-edit` in onNodeClick). A staged new table
              reopens its CREATE instead; a table staged for DROP is going away,
              so it isn't editable at all. */}
          {!data.dropped && (
            <button
              type="button"
              className="table-edit flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded text-ink-faint opacity-0 transition-opacity hover:bg-black/10 hover:text-ink group-hover:opacity-100"
              title="Edit table"
            >
              <EditIcon width={12} height={12} />
            </button>
          )}
        </div>
        <div style={{ paddingTop: PAD_T, paddingBottom: PAD_T }}>
          {data.columns.map((c, i) => {
            const involved = data.srcCols.has(c.name) || data.tgtCols.has(c.name)
            // Column-level staged edits (mirror the Changes panel): a newly
            // ADDed column is green; one whose type changed is amber; one
            // staged for DROP COLUMN — or any column of a table staged for
            // DROP — is red + struck through.
            const pendingCol = data.pendingCols.has(c.name)
            const changedCol = data.changedCols?.has(c.name)
            const droppedCol = data.dropped || data.droppedCols?.has(c.name)
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
                    droppedCol
                      ? 'text-red/70 line-through'
                      : pendingCol
                        ? 'text-green-bright'
                        : changedCol
                          ? 'text-amber'
                          : c.pk
                            ? 'font-semibold text-ink'
                            : 'text-ink-dim'
                  }`}
                >
                  {c.name}
                </span>
                <span
                  className={`font-mono text-[10px] ${
                    droppedCol ? 'text-red/60 line-through' : pendingCol ? 'text-green-bright' : changedCol ? 'text-amber' : 'text-ink-faint'
                  }`}
                >
                  {(c.type || '').toUpperCase()}
                </span>
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

// ---- Custom node: a translucent region wrapping a folder's tables ----
// A translucent backdrop sized to the bounding box of its member tables (see
// folderGroups below). The whole region is a drag surface, so it's painted
// under both the tables and the FK lines (zIndex -1) to stay out of the way of
// clicks meant for them.
function FolderGroupNode({ data }) {
  const [hover, setHover] = useState(false)
  const color = data.color || '#94a3b8'
  return (
    // The whole region is the drag surface (grab anywhere — the header bar or the
    // padding around the tables — to move the group and its tables together).
    // Tables paint above it (higher zIndex), so clicking/dragging a table still
    // hits the table, not the region. Hovering highlights the grabbable region.
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative h-full w-full cursor-grab rounded-[14px] border-2 transition-[background-color,box-shadow] active:cursor-grabbing"
      style={{
        borderColor: color,
        backgroundColor: hover ? `${color}24` : `${color}12`,
        boxShadow: hover ? `0 0 0 2px ${color}66` : 'none',
      }}
    >
      {/* Header bar: an obvious, wide grab target. Its edit button opens the
          folder editor (detected via the `.folder-edit` class in onNodeClick). */}
      <div
        className="absolute inset-x-0 top-0 flex h-[22px] items-center gap-1.5 rounded-t-[12px] px-2 transition-colors"
        style={{ backgroundColor: hover ? `${color}40` : `${color}26` }}
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="flex-1 truncate text-[11px] font-semibold" style={{ color }}>
          {data.name}
        </span>
        {/* Edit affordance — revealed on hover, matching the table cards; click
            opens the folder editor (detected via `.folder-edit` in onNodeClick).
            Only a *host* folder has an editor: a group carried by the design
            (an imported one, in an editor with no folders of its own) is drawn
            and dragged here but lives in the layout, not in a folders table. */}
        {data.editable && (
          <button
            type="button"
            className={`folder-edit flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded transition-opacity hover:bg-black/10 ${
              hover ? 'opacity-100' : 'opacity-0'
            }`}
            style={{ color }}
            title="Edit folder"
          >
            <EditIcon width={12} height={12} />
          </button>
        )}
      </div>
    </div>
  )
}

// ---- Custom node: a sticky note ----
// Free text pinned to the canvas — the "why" a diagram can't show: what a table
// is for, what still has to be decided, who to ask. It is part of the design
// (position, size, colour and text are all saved with the draft and travel in
// the design export), and part of nothing else: a note never becomes DDL.
//
// Double-clicking opens the textarea (`nodrag`/`nowheel` so typing and
// scrolling inside it aren't a canvas gesture); right-clicking recolours or
// deletes it; selecting it reveals React Flow's resize handles.
function NoteNode({ data, selected }) {
  const color = data.color || NOTE_DEFAULT_COLOR
  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden rounded-soft border-2 transition-colors"
      style={{ borderColor: color, backgroundColor: `${color}1f` }}
    >
      {/* Resize handles only once the note is selected, so an unselected note
          is a plain card and the canvas stays quiet. */}
      <NodeResizer
        color={color}
        isVisible={selected}
        minWidth={NOTE_MIN_W}
        minHeight={NOTE_MIN_H}
        lineClassName="!border-transparent"
      />
      <div className="flex h-[22px] shrink-0 items-center gap-1.5 px-2" style={{ backgroundColor: `${color}30` }}>
        <NoteIcon width={11} height={11} style={{ color }} />
        <span className="flex-1 truncate text-[10px] font-bold uppercase tracking-wide" style={{ color }}>
          Note
        </span>
      </div>
      <div className="min-h-0 flex-1 px-2 py-1.5">
        {data.editing ? (
          <textarea
            // `nodrag` keeps a text selection from panning the note, `nowheel`
            // keeps scrolling the text from zooming the canvas.
            className="nodrag nowheel h-full w-full resize-none border-0 bg-transparent p-0 text-[11px] leading-relaxed text-ink outline-none"
            value={data.text}
            autoFocus
            placeholder="Write a note…"
            onChange={(e) => data.onChangeText(e.target.value)}
            onBlur={data.onEditDone}
          />
        ) : (
          <p className={`h-full overflow-hidden whitespace-pre-wrap break-words text-[11px] leading-relaxed ${data.text ? 'text-ink' : 'text-ink-faint'}`}>
            {data.text || 'Double-click to write…'}
          </p>
        )}
      </div>
    </div>
  )
}

const nodeTypes = { table: TableNode, folderGroup: FolderGroupNode, note: NoteNode }

// ---- Parse staged change SQL into pending tables / columns ----
// A staged CREATE TABLE — the source of truth for a not-yet-committed table,
// both to draw it and to reopen it in the create-table form for editing.
const CREATE_TABLE_RE = /^\s*CREATE TABLE\s+"([^"]+)"\s*\(([\s\S]*)\)\s*;?\s*$/i

// Parse staged FK add/drop SQL (from drag-to-connect diagram edits, or the
// "Foreign key" section of TableEditPanel) so they can be drawn on the
// diagram before they're committed. Returns constraints being added and a
// name -> item id
// map of constraints being dropped (only the local `pending` id is trackable
// for undo — items already pushed to the Changes panel are display-only).
// Stable empty defaults — see the note on SchemaEditor's signature.
const NO_FOLDERS = []
const NO_PENDING = []

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
  const newTables: Record<string, any[]> = {} // name -> parsed column models
  const newCols = {} // table -> { colName: type }
  const droppedTables = new Set() // names of tables staged for DROP
  const droppedCols = {} // table -> Set(colName) staged for DROP COLUMN
  const retypedCols = {} // table -> { colName: newType } staged for ALTER COLUMN TYPE
  for (const ch of changes || []) {
    const sql = ch.sql || ''
    let m = sql.match(CREATE_TABLE_RE)
    if (m) {
      newTables[m[1]] = parseColumnDefs(m[2])
      continue
    }
    m = sql.match(/^\s*DROP TABLE\s+(?:IF EXISTS\s+)?"([^"]+)"\s*;?\s*$/i)
    if (m) {
      droppedTables.add(m[1])
      continue
    }
    m = sql.match(/^\s*ALTER TABLE\s+"([^"]+)"\s+DROP COLUMN\s+"([^"]+)"\s*;?\s*$/i)
    if (m) {
      ;(droppedCols[m[1]] ||= new Set()).add(m[2])
      continue
    }
    m = sql.match(/^\s*ALTER TABLE\s+"([^"]+)"\s+ALTER COLUMN\s+"([^"]+)"\s+TYPE\s+([^;]+?)\s*;?\s*$/i)
    if (m) {
      ;(retypedCols[m[1]] ||= {})[m[2]] = m[3]
      continue
    }
    // Capture the type up to the first modifier / trailing `;` so it doesn't
    // carry the statement terminator (which broke FK type-matching + display).
    m = sql.match(/^\s*ALTER TABLE\s+"([^"]+)"\s+ADD COLUMN\s+"([^"]+)"\s+([^;]+?)\s*(?:\b(?:NOT NULL|PRIMARY KEY|DEFAULT|REFERENCES)\b.*)?;?\s*$/i)
    if (m) (newCols[m[1]] ||= {})[m[2]] = m[3]
  }
  return { newTables, newCols, droppedTables, droppedCols, retypedCols }
}


// Reusable export format list (used by the toolbar dropdown and the canvas menu).
function ExportItems({ onExport }) {
  return (
    <>
      {/* The design file first: it is the only export that can be imported
          back — the three below are pictures. */}
      <MenuItem onClick={() => onExport('design')}>
        <DownloadIcon width={14} height={14} /> Design (JSON)
      </MenuItem>
      <div className="my-1 h-px bg-edge" />
      <MenuItem onClick={() => onExport('png')}>
        <DownloadIcon width={14} height={14} /> PNG image
      </MenuItem>
      <MenuItem onClick={() => onExport('jpg')}>
        <DownloadIcon width={14} height={14} /> JPG image
      </MenuItem>
      <MenuItem onClick={() => onExport('svg')}>
        <DownloadIcon width={14} height={14} /> SVG vector
      </MenuItem>
    </>
  )
}

// Popover's panel has no padding of its own; ContextMenuSub's already does.
function ExportOptions({ onExport }) {
  return (
    <div className="p-1">
      <ExportItems onExport={onExport} />
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

// Every callback here is optional (each is invoked with `?.`, and `changes` is
// read as `changes || []`), so a host wires up only what it can answer for. The
// draft page is now the only host: it passes the connection's table folders,
// and Release rather than Submit. `changes` / `onStageItems` / `onOpenTable` /
// `onOpenSchema` are the console's half of the contract — a diagram hosted
// beside a Changes queue and a data grid — and stay optional for a host that
// has one again. Annotated `any` so the signature says all of that.
//
// The array defaults are module constants, never `= []` inline: `folders` and
// `pending` are dependencies of `layoutNodes`, which the node-building effect
// depends on in turn. A fresh `[]` each render makes that effect fire on every
// render and `setNodes` with new objects each time — a loop React Flow can
// never settle, because it loses every node's measured size on each pass. It
// only bites a host that omits the prop.
export default function SchemaEditor({ conn, changes, folders = NO_FOLDERS, onUpdateFolder, onDeleteFolder, onSetFolder, pending = NO_PENDING, onPendingChange, onStageItems, onSaveDraft, onUpdateDraft, draftId, layout, onOpenTable, onOpenSchema, releaseTarget = null, releaseHint = '', onRelease, releasing = false, layoutRef }: any) {
  const dialect = conn.type === 'postgresql' ? 'postgresql' : 'sqlite'
  // Submit hands the staged DDL to a Changes queue, so it exists exactly when
  // the host has one — `onStageItems`. The console does; the standalone editor
  // page does not, whether or not there is a database behind the draft (a
  // from-scratch one has nothing to execute against, and a connection-linked
  // one commits in that connection's console). Save and Export are the whole
  // story without a queue.
  //
  // Release is the other end of that: it runs the staged DDL *now*, against
  // `releaseTarget` — so it exists exactly where a host can execute without a
  // queue in front of it (the standalone page), and a host with a queue shows
  // Submit instead. One target, never a choice: a design releases to the
  // database it was designed against. A design with none yet (from scratch)
  // passes a null target and `releaseHint` saying what to do about it — the
  // button stays visible and disabled, because "you can't do this yet, here is
  // why" is the answer, and a missing button isn't. Nothing runs before
  // ReleaseDialog is confirmed.
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
  const [menu, setMenu] = useState(null) // canvas context menu { x, y (screen), flow (canvas coords) }
  const [nodeMenu, setNodeMenu] = useState(null) // table right-click menu { x, y, table, pending }
  const [editingFolder, setEditingFolder] = useState(null) // folder being edited from the canvas | null
  const [creating, setCreating] = useState(false) // create-table panel open
  const [editingDraft, setEditingDraft] = useState(null) // staged new table being re-edited { table, columns }
  const [naming, setNaming] = useState(false) // "save as draft" name prompt open
  const canEditFk = dialect === 'postgresql' // drag-to-connect FK editing (SQLite can't alter FKs)

  // ---- The design: what the diagram looks like, beside what it *is* ----
  // The DDL says which tables exist; this says where they sit, what is written
  // on the canvas beside them and which regions are drawn around them. It is
  // seeded from the draft's saved layout, updated as things are dragged, and
  // handed back to the host on Save (see `currentLayout`).
  const savedLayout = useMemo(() => (layout ? normalizeLayout(layout) : emptyLayout()), [layout])
  const [notes, setNotes] = useState<SchemaNote[]>(() => savedLayout.notes)
  // Groups the *design* carries, as opposed to the host's table folders. An
  // editor with a connection behind it has real folders and these stay empty;
  // a from-scratch draft (or an imported design) has only these.
  const [designGroups, setDesignGroups] = useState(() => savedLayout.groups)
  const [editingNote, setEditingNote] = useState(null) // note id whose textarea is open
  const [selectedNote, setSelectedNote] = useState(null) // note id showing its resize handles
  const [noteMenu, setNoteMenu] = useState(null) // note right-click menu { x, y, id }
  const [importDoc, setImportDoc] = useState<SchemaDesignDoc | null>(null) // parsed design file awaiting confirmation
  const [releaseOpen, setReleaseOpen] = useState(false) // release confirmation open
  const importRef = useRef<HTMLInputElement>(null)
  // Where each table was last seen, including ones currently hidden — the
  // arrangement outlives both a rebuild of the node list and a table being
  // toggled off, so neither loses a position the user placed by hand.
  const placedTables = useRef<Record<string, { x: number; y: number }>>({ ...savedLayout.tables })

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

  // The still-local staged CREATE TABLE for `table`. Only items in `pending`
  // are editable here — once submitted to the Changes queue they're owned by
  // that panel and are display-only on the diagram.
  const pendingCreate = (table) =>
    pending.find((p) => {
      const m = (p.sql || '').match(CREATE_TABLE_RE)
      return m && m[1] === table
    })

  // Reopen a staged new table in the create-table form, parsed back from its
  // own CREATE TABLE, so it can be edited before it's ever committed.
  const editPendingTable = (table) => {
    const item = pendingCreate(table)
    if (!item) {
      toast.error(`“${table}” is already in the Changes queue — undo it there to edit it.`)
      return
    }
    setEditingDraft({ table, columns: parseColumnDefs(item.sql.match(CREATE_TABLE_RE)[2]) })
  }

  // Restage an edited draft: its old statements go, the rebuilt CREATE lands in
  // their place. Mirrors deleteTable's "a pending table is just its statements".
  const replacePendingTable = (oldName, statements, newName) =>
    onPendingChange?.([
      ...pending.filter((p) => p.table !== oldName),
      ...statements.map((sql) => ({ id: newItemId(), sql, table: newName, mode: 'new' })),
    ])

  // Edit a table — a committed one via ALTER (TableEditPanel), a staged new one
  // by reopening its CREATE (CreateTablePanel).
  const openTableEditor = (table, isPending) => (isPending ? editPendingTable(table) : setSelected(table))

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
    const { newTables, newCols, droppedTables, droppedCols, retypedCols } = parsePending([...pending, ...(changes || [])])
    const existing = new Set(diagram.tables.map((t) => t.name))
    const tables = diagram.tables.map((t) => {
      const add = newCols[t.name]
      const drop = droppedCols[t.name] // Set of column names staged for DROP
      const retype = retypedCols[t.name] // { colName: newType } staged for type change
      const pendingCols = new Set()
      const changedCols = new Set()
      // Reflect staged type changes on the shown column type (amber).
      let columns = t.columns.map((c) => {
        if (retype && retype[c.name] !== undefined) {
          changedCols.add(c.name)
          return { ...c, type: retype[c.name] }
        }
        return c
      })
      if (add) {
        const extra = Object.entries(add)
          .filter(([c]) => !t.columns.some((x) => x.name === c))
          .map(([c, type]) => ({ name: c, type }))
        extra.forEach((c) => pendingCols.add(c.name))
        columns = [...columns, ...extra]
      }
      return {
        ...t,
        columns,
        pending: false,
        pendingCols,
        changedCols,
        droppedCols: drop || new Set(),
        dropped: droppedTables.has(t.name),
      }
    })
    for (const [name, cols] of Object.entries(newTables)) {
      if (existing.has(name)) continue
      // The parsed columns keep type and length apart (as the form needs them);
      // the diagram wants the SQL spelling back, like a committed column's.
      tables.push({
        name,
        columns: cols.map((c) => ({ ...c, type: columnTypeSql(c) })),
        pending: true,
        pendingCols: new Set(),
      })
    }
    return tables
  }, [diagram, changes, pending])

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  // Mirror live node positions for the connection-line component's cursor
  // hit-testing (columnAt). onNodesChange updates positions during node drags
  // too, so keep it in sync on every nodes change.
  liveNodes.current = nodes
  // …and remember them, so a table keeps its place across a node-list rebuild
  // (staging a change) and across being hidden and shown again. This is also
  // what Save writes out for a table that is currently hidden.
  for (const n of nodes) placedTables.current[n.id] = n.position
  const rf = useRef(null)
  const canvasWrapRef = useRef(null) // canvas container — for positioning the FK edit popup from the sidebar
  // Set by onConnect right before onConnectEnd fires for the same gesture —
  // lets onConnectEnd (which has the mouse position) open the confirm modal.
  const pendingConnectRef = useRef(null)

  // Node size (matches the fixed row metrics) so dagre arranges without overlaps.
  const sizeOf = (t) => ({ w: NODE_W, h: HEADER_H + PAD_T * 2 + t.columns.length * ROW_H })

  // Inner padding a folder region reserves around its member tables, plus the
  // top strip for its draggable label. Kept in sync with folderGroups (below),
  // which derives the region rectangle from the same members.
  const FOLDER_PAD = 22
  const FOLDER_LABEL_H = 26

  // Build a table React Flow node at an absolute position.
  const tableNodeAt = useCallback(
    (t, position) => ({
      id: t.name,
      type: 'table',
      zIndex: 1, // paint above the FK lines and the folder regions (zIndex -1)
      position,
      style: { width: NODE_W },
      data: {
        name: t.name,
        columns: t.columns,
        pending: t.pending,
        dropped: t.dropped,
        pendingCols: t.pendingCols,
        changedCols: t.changedCols,
        droppedCols: t.droppedCols,
        srcCols: fkInfo.src[t.name] || new Set(),
        tgtCols: fkInfo.tgt[t.name] || new Set(),
        canEditFk,
      },
    }),
    [fkInfo, canEditFk]
  )

  // Arrange tables with dagre. Tables sharing a folder are clustered into their
  // own block (laid out internally, then placed as one unit), so each folder
  // region wraps only its members and never overlaps a foreign table. Ranks
  // follow FK relationships, no collisions.
  const layoutNodes = useCallback(() => {
    const visible = augmented.filter((t) => !hiddenTables.has(t.name))
    const sizes = {}
    for (const t of visible) sizes[t.name] = sizeOf(t)

    // Which folder (if any, and only if it has a visible member) each table is in.
    const folderOf = {}
    for (const d of folders) for (const tn of d.tables || []) folderOf[tn] = d.id
    const activeFolders = new Set(visible.map((t) => folderOf[t.name]).filter(Boolean))

    // 1) Lay out each folder's members internally → relative offsets + inner size.
    const inner = {} // folderId -> { rel: {table -> {x,y}}, w, h }
    for (const did of activeFolders) {
      const members = visible.filter((t) => folderOf[t.name] === did)
      const g = new dagre.graphlib.Graph()
      g.setDefaultEdgeLabel(() => ({}))
      g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80, marginx: 0, marginy: 0 })
      for (const t of members) g.setNode(t.name, { width: sizes[t.name].w, height: sizes[t.name].h })
      for (const fk of diagram.foreignKeys) {
        if (folderOf[fk.table] === did && folderOf[fk.refTable] === did && fk.table !== fk.refTable) g.setEdge(fk.table, fk.refTable)
      }
      dagre.layout(g)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      const rel = {}
      for (const t of members) {
        const p = g.node(t.name)
        const s = sizes[t.name]
        const x = p.x - s.w / 2, y = p.y - s.h / 2
        rel[t.name] = { x, y }
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + s.w); maxY = Math.max(maxY, y + s.h)
      }
      // Normalize so the top-left member sits at (PAD, PAD + LABEL_H) inside the block.
      for (const t of members) { rel[t.name].x += FOLDER_PAD - minX; rel[t.name].y += FOLDER_PAD + FOLDER_LABEL_H - minY }
      inner[did] = { rel, w: maxX - minX + FOLDER_PAD * 2, h: maxY - minY + FOLDER_PAD * 2 + FOLDER_LABEL_H }
    }

    // 2) Lay out blocks: each folder (as one node) + each ungrouped table.
    const blockOf = (table) => (activeFolders.has(folderOf[table]) ? `d:${folderOf[table]}` : `t:${table}`)
    const g2 = new dagre.graphlib.Graph()
    g2.setDefaultEdgeLabel(() => ({}))
    g2.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120, marginx: 24, marginy: 24 })
    for (const did of activeFolders) g2.setNode(`d:${did}`, { width: inner[did].w, height: inner[did].h })
    for (const t of visible) if (!activeFolders.has(folderOf[t.name])) g2.setNode(`t:${t.name}`, { width: sizes[t.name].w, height: sizes[t.name].h })
    const seen = new Set()
    for (const fk of diagram.foreignKeys) {
      if (fk.table === fk.refTable || hiddenTables.has(fk.table) || hiddenTables.has(fk.refTable)) continue
      const a = blockOf(fk.table), b = blockOf(fk.refTable)
      if (a === b) continue
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      if (seen.has(key)) continue
      seen.add(key)
      g2.setEdge(a, b)
    }
    dagre.layout(g2)

    // 3) Expand blocks back into absolute table positions.
    const out = []
    for (const did of activeFolders) {
      const b = g2.node(`d:${did}`)
      const bx = b.x - inner[did].w / 2, by = b.y - inner[did].h / 2
      for (const t of visible) {
        if (folderOf[t.name] !== did) continue
        const r = inner[did].rel[t.name]
        out.push(tableNodeAt(t, { x: bx + r.x, y: by + r.y }))
      }
    }
    for (const t of visible) {
      if (activeFolders.has(folderOf[t.name])) continue
      const b = g2.node(`t:${t.name}`)
      const s = sizes[t.name]
      out.push(tableNodeAt(t, { x: b.x - s.w / 2, y: b.y - s.h / 2 }))
    }
    return out
  }, [augmented, diagram, hiddenTables, folders, tableNodeAt])

  const toggleTable = (name) =>
    setHiddenTables((s) => {
      const n = new Set(s)
      n.has(name) ? n.delete(name) : n.add(name)
      return n
    })
  const showAllTables = () => setHiddenTables(new Set())
  const hideAllTables = () => setHiddenTables(new Set(augmented.map((t) => t.name)))

  // (Re)build nodes whenever the diagram or staged changes update, but keep the
  // position of every table already on the canvas — once a table is placed
  // (by the initial layout, by the saved design, or by the user dragging it)
  // nothing reshuffles it. Re-arranging the whole diagram is an explicit
  // action: right-click the canvas → Auto arrange (or the schema.autoLayout
  // shortcut), which is also the one thing that discards saved positions.
  //
  // Three sources, in order: the position a node already has on the canvas, the
  // one remembered for it (hidden, restored from the draft's saved design, or
  // imported), and — only for a table genuinely new here — dagre's.
  useEffect(() => {
    setNodes((prev) => {
      const placed = {}
      for (const n of prev) placed[n.id] = n.position
      return layoutNodes().map((n) => {
        const at = placed[n.id] || placedTables.current[n.id]
        return at ? { ...n, position: at } : n
      })
    })
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
  // Every region the canvas draws, from both sources: the host's table folders
  // (real rows — those keep their editor) and the groups the design itself
  // carries (an imported one, or a draft with no connection and so no folders
  // at all). Same shape either way, so the region code below has one list.
  const allGroups = useMemo(() => {
    const host = folders.map((f) => ({
      id: f.id,
      name: f.name,
      color: f.color,
      tables: f.tables || [],
      editable: true,
      rect: null,
    }))
    const hostIds = new Set(host.map((g) => g.id))
    // A design group whose folder exists here is that folder — the row wins, so
    // re-importing a design into its own connection doesn't double the region.
    const carried = designGroups
      .filter((g) => !hostIds.has(g.id))
      .map((g) => ({ id: g.id, name: g.name, color: g.color, tables: g.tables, editable: false, rect: { x: g.x, y: g.y, w: g.w, h: g.h } }))
    return [...host, ...carried]
  }, [folders, designGroups])

  // Folder regions: one translucent region per folder, sized to the bounding
  // box of its visible member tables (using live node positions, so the region
  // tracks member drags). Painted behind the tables and the FK lines (see the
  // zIndex note below). Grabbing anywhere on the region drags the whole group
  // (see handleNodesChange); its header's edit button opens the folder editor.
  const folderGroups = useMemo(() => {
    if (!allGroups.length) return []
    const byTable = {}
    for (const n of nodes) byTable[n.id] = n
    const heightOf = (n) => HEADER_H + PAD_T * 2 + (n.data.columns?.length || 0) * ROW_H
    return allGroups
      .map((d) => {
        const members = (d.tables || []).map((t) => byTable[t]).filter(Boolean)
        // With no member on the canvas there is no bounding box to derive — a
        // group the design carries falls back to the rectangle it was saved
        // with, so an imported diagram keeps its regions even where the tables
        // inside them are hidden. A host folder with nothing visible in it
        // draws nothing, exactly as before.
        if (!members.length) {
          if (!d.rect || d.rect.w <= 0 || d.rect.h <= 0) return null
          return {
            id: `folder:${d.id}`,
            type: 'folderGroup',
            position: { x: d.rect.x, y: d.rect.y },
            width: d.rect.w,
            height: d.rect.h,
            style: { width: d.rect.w, height: d.rect.h },
            data: { name: d.name, color: d.color, editable: d.editable },
            draggable: true,
            selectable: false,
            connectable: false,
            deletable: false,
            focusable: false,
            zIndex: -1,
          }
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const n of members) {
          const w = n.style?.width || NODE_W
          minX = Math.min(minX, n.position.x)
          minY = Math.min(minY, n.position.y)
          maxX = Math.max(maxX, n.position.x + w)
          maxY = Math.max(maxY, n.position.y + heightOf(n))
        }
        const w = maxX - minX + FOLDER_PAD * 2
        const h = maxY - minY + FOLDER_PAD * 2 + FOLDER_LABEL_H
        return {
          id: `folder:${d.id}`,
          type: 'folderGroup',
          position: { x: minX - FOLDER_PAD, y: minY - FOLDER_PAD - FOLDER_LABEL_H },
          // Provide explicit dimensions so React Flow never has to (re)measure
          // the node — otherwise it flips to visibility:hidden each time this
          // memo rebuilds during a drag, and a mousedown in that window falls
          // through to the pane (panning instead of dragging the group).
          width: w,
          height: h,
          style: { width: w, height: h },
          data: { name: d.name, color: d.color, editable: d.editable },
          draggable: true,
          selectable: false,
          connectable: false,
          deletable: false,
          focusable: false,
          // Must be negative, not 0: React Flow's edge <svg> has no z-index of
          // its own, so a region at 0 would paint over the FK lines crossing it
          // and swallow their clicks (the region is a full-rect drag surface).
          // Negative z-index descendants paint first, so the lines stay above
          // the region — and above the pane, since the transformed viewport is
          // the stacking context. Tables (zIndex 1) still paint over both.
          zIndex: -1,
        }
      })
      .filter(Boolean)
  }, [allGroups, nodes])

  // ---- Notes ----
  // Notes are not tables, so they never go through `nodes` (which is rebuilt
  // from the schema): they live in their own state and are merged in for
  // rendering, the same way folder regions are. Their drags and resizes come
  // back through handleNodesChange below.
  const updateNote = useCallback(
    (id, fields) => setNotes((list) => list.map((n) => (n.id === id ? { ...n, ...fields } : n))),
    []
  )
  const addNote = (at) => {
    const note: SchemaNote = {
      id: newNoteId(),
      x: at.x,
      y: at.y,
      w: NOTE_DEFAULT_W,
      h: NOTE_DEFAULT_H,
      text: '',
      color: NOTE_DEFAULT_COLOR,
    }
    setNotes((list) => [...list, note])
    // A new note is empty, so open it for typing straight away.
    setEditingNote(note.id)
    setSelectedNote(note.id)
  }
  const deleteNote = (id) => {
    setNotes((list) => list.filter((n) => n.id !== id))
    setEditingNote((cur) => (cur === id ? null : cur))
    setSelectedNote((cur) => (cur === id ? null : cur))
  }

  const noteNodes = useMemo(
    () =>
      notes.map((n) => ({
        id: `note:${n.id}`,
        type: 'note',
        position: { x: n.x, y: n.y },
        // Explicit dimensions for the same reason the folder regions state
        // theirs: React Flow must never have to measure a node it is resizing.
        width: n.w,
        height: n.h,
        style: { width: n.w, height: n.h },
        selected: selectedNote === n.id,
        data: {
          text: n.text,
          color: n.color,
          editing: editingNote === n.id,
          onChangeText: (text) => updateNote(n.id, { text }),
          onEditDone: () => setEditingNote((cur) => (cur === n.id ? null : cur)),
        },
        draggable: true,
        selectable: true,
        connectable: false,
        deletable: false,
        // Above the folder regions (−1), below the tables (1): a note annotates
        // the diagram, it never hides a table behind it.
        zIndex: 0,
      })),
    [notes, editingNote, selectedNote, updateNote]
  )

  const displayNodes = useMemo(
    () => [
      ...folderGroups,
      ...noteNodes,
      ...nodes.map((n) => (n.data.fkSides === fkEndpoints[n.id] ? n : { ...n, data: { ...n.data, fkSides: fkEndpoints[n.id] } })),
    ],
    [folderGroups, noteNodes, nodes, fkEndpoints]
  )

  // Folder regions aren't stored in node state (they're derived from members),
  // so dragging one is translated here into position changes for its member
  // tables — the region then follows the members it wraps. Everything else
  // passes straight through to useNodesState's handler.
  const handleNodesChange = useCallback(
    (changes) => {
      const passthrough = []
      const extra = []
      for (const ch of changes) {
        // Notes own their geometry, so a drag or a resize is written straight
        // into the note rather than into table state.
        if (ch.id?.startsWith?.('note:')) {
          const noteId = ch.id.slice(5)
          if (ch.type === 'position' && ch.position) updateNote(noteId, { x: ch.position.x, y: ch.position.y })
          else if (ch.type === 'dimensions' && ch.dimensions)
            updateNote(noteId, {
              w: Math.max(NOTE_MIN_W, Math.round(ch.dimensions.width)),
              h: Math.max(NOTE_MIN_H, Math.round(ch.dimensions.height)),
            })
          else if (ch.type === 'select') setSelectedNote((cur) => (ch.selected ? noteId : cur === noteId ? null : cur))
          continue
        }
        if (ch.id?.startsWith?.('folder:')) {
          if (ch.type === 'position' && ch.position) {
            const grp = folderGroups.find((g) => g.id === ch.id)
            if (grp) {
              const dx = ch.position.x - grp.position.x
              const dy = ch.position.y - grp.position.y
              if (dx || dy) {
                const dom = allGroups.find((d) => `folder:${d.id}` === ch.id)
                const members = (dom?.tables || []).map((tn) => liveNodes.current.find((n) => n.id === tn)).filter(Boolean)
                if (members.length) {
                  for (const node of members)
                    extra.push({ id: node.id, type: 'position', position: { x: node.position.x + dx, y: node.position.y + dy }, dragging: ch.dragging })
                } else if (dom && !dom.editable) {
                  // A design group with nothing visible inside it is its own
                  // rectangle — there are no members to push around, so the
                  // drag moves the stored rect itself.
                  setDesignGroups((list) => list.map((g) => (g.id === dom.id ? { ...g, x: ch.position.x, y: ch.position.y } : g)))
                }
              }
            }
          }
          continue // never apply folder-node changes to table state
        }
        passthrough.push(ch)
      }
      onNodesChange([...passthrough, ...extra])
    },
    [onNodesChange, folderGroups, allGroups, updateNote]
  )

  // ---- Sidebar focus / edit actions ----
  const fitToNodes = (ids) => {
    const list = ids.filter(Boolean).map((id) => ({ id }))
    if (list.length) rf.current?.fitView({ nodes: list, duration: 400, padding: 0.35, maxZoom: 1.2 })
  }
  // Reveal any hidden tables in `names`, then (after they've been laid out) fit
  // the view to `focus`. If nothing was hidden, fit immediately.
  const revealAndFit = (names, focus) => {
    const hidden = names.filter((n) => hiddenTables.has(n))
    if (hidden.length) {
      setHiddenTables((s) => {
        const next = new Set(s)
        hidden.forEach((n) => next.delete(n))
        return next
      })
      setTimeout(() => fitToNodes(focus), 90)
    } else {
      fitToNodes(focus)
    }
  }
  const focusTable = (name) => revealAndFit([name], [name])
  const focusFolder = (d) => revealAndFit(d.tables || [], d.tables || [])
  // Focus a foreign key's two tables and open its edit popup (centered near the
  // top of the canvas, since there's no click point from the list).
  const openReference = (fk, i) => {
    const both = [fk.table, fk.refTable]
    revealAndFit(both, both)
    setSelectedEdge(`e${i}`)
    const rect = canvasWrapRef.current?.getBoundingClientRect()
    setEdgePopup({ x: rect ? rect.left + rect.width / 2 - 110 : 240, y: rect ? rect.top + 70 : 120, fk })
    setFkEdit(
      canEditFk && fk.constraint && !fk.pendingFk && !fk.removed
        ? { onDelete: normFkAction(fk.onDelete), onUpdate: normFkAction(fk.onUpdate) }
        : null
    )
  }

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

  // ---- The design, as it stands right now ----
  // What Save persists and what the design file carries: every table position
  // (including the ones currently hidden — see placedTables), the notes, and
  // each region's rectangle. Group rects are read off the rendered regions, so
  // a folder region that follows its tables is written out where it actually is.
  const currentLayout = useCallback((): SchemaLayout => {
    const rects = {}
    for (const g of folderGroups) rects[g.id.slice(7)] = { x: g.position.x, y: g.position.y, w: g.width, h: g.height }
    const tables = {}
    for (const [name, pos] of Object.entries(placedTables.current)) tables[name] = { x: Math.round(pos.x), y: Math.round(pos.y) }
    return {
      version: LAYOUT_VERSION,
      tables,
      notes,
      groups: allGroups.map((g) => {
        const r = rects[g.id] || g.rect || { x: 0, y: 0, w: 0, h: 0 }
        return {
          id: g.id,
          name: g.name,
          color: g.color ?? null,
          tables: g.tables || [],
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.w),
          h: Math.round(r.h),
        }
      }),
    }
  }, [folderGroups, allGroups, notes])

  // A host that acts on the draft from *outside* the canvas — the page's "Link
  // to connection", which moves the design to another row — still has to write
  // the arrangement as it stands, not as it was last saved. Every other caller
  // gets it handed to them (Save, Save as, Release); this one has to ask.
  useEffect(() => {
    if (layoutRef) layoutRef.current = currentLayout
  }, [layoutRef, currentLayout])

  // ---- Design export / import ----
  // The image formats next door are a *picture* of the diagram; this is the
  // diagram: the staged DDL the draft holds plus the whole arrangement around
  // it. Importing one rebuilds both, which is what makes a design portable
  // between drafts (and between instances).
  const exportDesign = () => {
    const doc = buildDesignDoc({
      name: conn.name || 'schema',
      dialect: conn.type || dialect,
      statements: pending.map((p) => p.sql),
      layout: currentLayout(),
    })
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = designFileName(conn.name || 'schema')
    a.click()
    URL.revokeObjectURL(url)
  }

  const readImportFile = async (file) => {
    try {
      setImportDoc(parseDesignDoc(await file.text()))
    } catch (e: any) {
      toast.error(`Import failed: ${e.message}`)
    }
  }

  // Applying an import replaces the working state wholesale — the staged DDL,
  // the notes, the groups and every position — which is why it asks first.
  const applyImport = () => {
    if (!importDoc) return
    const imported = importDoc.layout
    placedTables.current = { ...imported.tables }
    setNotes(imported.notes)
    setDesignGroups(imported.groups)
    // An imported table that happened to be hidden here would arrive invisible.
    setHiddenTables(new Set())
    onPendingChange?.(draftToItems(importDoc.statements.join('\n')))
    // Tables already on the canvas move now; ones the imported DDL creates are
    // placed by the rebuild effect, which reads the same placedTables.
    setNodes((prev) => prev.map((n) => (imported.tables[n.id] ? { ...n, position: imported.tables[n.id] } : n)))
    setImportDoc(null)
    toast.success('Design imported.')
    setTimeout(() => rf.current?.fitView({ duration: 300, padding: 0.2 }), 80)
  }

  // The export menu's one handler: the design file, or one of the pictures.
  const runExport = (fmt) => (fmt === 'design' ? exportDesign() : exportImage(fmt))

  const autoLayout = () => {
    // Auto arrange is the one action that throws the saved arrangement away —
    // otherwise the next rebuild would put every table back where it was.
    placedTables.current = {}
    setNodes(layoutNodes())
    setTimeout(() => rf.current?.fitView({ duration: 300, padding: 0.2 }), 0)
  }

  useShortcut('schema.createTable', () => setCreating(true))
  useShortcut('schema.autoLayout', autoLayout)

  // Export the whole diagram (all nodes) as a PNG/JPG image.
  const exportImage = async (fmt) => {
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement
    if (!viewport || !displayNodes.length) return
    const pad = 48
    // Every node, not just the tables: a note or a group region sitting outside
    // the tables' bounding box is part of the picture and used to be cropped.
    const bounds = getRectOfNodes(displayNodes as any)
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
        {/* Submit — move the pending changes into a host's Changes queue, ready
            to execute; shown only for a host that has one. Save — persist as a
            draft: update the linked draft when this editor was opened from one,
            otherwise create the first draft. Save as draft — only meaningful
            once linked, forks a *copy* into a new draft (Save / Save As), so
            it's hidden on a fresh editor. */}
        {onStageItems && (
          <Button
            variant="primary"
            size="sm"
            icon={SaveIcon}
            onClick={() => { onStageItems(pending); clearPending() }}
            disabled={pending.length === 0}
          >
            Submit
          </Button>
        )}

        {/* Release — run the staged DDL against the database now. Primary where
            there is no Submit beside it (the standalone page): there, it is the
            only way a design reaches a database. Disabled with nothing staged,
            and with no database to release to — where `releaseHint` is the whole
            explanation the button can give. */}
        {onRelease && (
          <Button
            variant={onStageItems ? 'ghost' : 'primary'}
            size="sm"
            icon={PlayIcon}
            onClick={() => setReleaseOpen(true)}
            disabled={pending.length === 0 || releasing || !releaseTarget}
            title={releaseTarget ? `Run the staged changes against ${releaseTarget.name}` : releaseHint}
          >
            {releasing ? 'Releasing…' : 'Release'}
          </Button>
        )}

        {/* Enabled with nothing staged *once there is a draft to write to*:
            emptying the changes is itself an edit — you removed the last staged
            statement and want the draft to record that — and with Save disabled
            at zero there was no way to persist it, so the draft kept the
            statement you had just deleted. Only creating the first draft still
            needs something in it; an unnamed, empty new draft is nothing. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (draftId ? onUpdateDraft?.(draftId, pending, currentLayout()) : setNaming(true))}
          disabled={pending.length === 0 && !draftId}
        >
          Save
        </Button>

        {draftId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setNaming(true)}
          >
            Save as
          </Button>
        )}

        {pending.length > 0 && (
          <>
            <Button variant="subtle" size="sm" onClick={clearPending}>
              Discard
            </Button>
            <span className="text-[11px] font-semibold text-amber">
              {pending.length} pending change{pending.length > 1 ? 's' : ''}
            </span>
          </>
        )}

        <span className="ml-1 text-[11px] text-ink-faint">{conn.name} · {diagram.tables.length} table(s)</span>

        {/* Right cluster — show/hide all tables + Export */}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold">
            <span className="text-ink-faint">Tables</span>
            <TextButton tone="green" className="!text-[11px]" onClick={showAllTables}>
              All
            </TextButton>
            <span className="text-ink-faint">·</span>
            <TextButton className="!text-[11px]" onClick={hideAllTables}>
              None
            </TextButton>
          </div>

          <Button variant="subtle" size="sm" icon={UploadIcon} onClick={() => importRef.current?.click()} disabled={loading}>
            Import
          </Button>
          {/* Reset on open so re-picking the same file still fires `change`. */}
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onClick={(e) => ((e.target as HTMLInputElement).value = '')}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) readImportFile(f)
            }}
          />

          <Popover
            align="right"
            width={170}
            trigger={({ open, toggle }) => (
              <Button
                variant="subtle"
                size="sm"
                icon={DownloadIcon}
                chevron
                active={open}
                onClick={toggle}
                disabled={loading}
              >
                Export
              </Button>
            )}
          >
            {({ close }) => <ExportOptions onExport={(f) => { runExport(f); close() }} />}
          </Popover>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <SchemaSidebar
          pending={pending}
          onRemovePending={removePendingItem}
          tables={augmented}
          hiddenTables={hiddenTables}
          onToggleTable={toggleTable}
          onFocusTable={focusTable}
          foreignKeys={augmentedForeignKeys}
          onEditReference={openReference}
          folders={folders}
          onFocusFolder={focusFolder}
        />
        <div
          ref={canvasWrapRef}
          className="relative min-w-0 flex-1"
          onContextMenu={(e) => {
            e.preventDefault()
            // Two coordinate systems: the menu is positioned in screen space,
            // but "Add note" places a node in flow space — so capture both at
            // the click, while the cursor is still where the user pointed.
            const rect = canvasWrapRef.current?.getBoundingClientRect()
            const flow = rf.current?.project?.({ x: e.clientX - (rect?.left || 0), y: e.clientY - (rect?.top || 0) }) || { x: 0, y: 0 }
            setMenu({ x: e.clientX, y: e.clientY, flow })
          }}
        >
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-ink-faint">Loading schema…</div>
          ) : (
            <>
              <ReactFlow
                nodes={displayNodes}
                edges={edgesWithPreview as any}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes as any}
                connectionLineComponent={FkConnectionLine as any}
                connectionMode={ConnectionMode.Loose}
                onNodesChange={handleNodesChange}
                onInit={(inst) => (rf.current = inst)}
                // Dragging shouldn't select a node (which would leave the active
                // green outline stuck on it) — only an explicit click selects.
                selectNodesOnDrag={false}
                isValidConnection={isValidConnection}
                onConnect={onConnect}
                onConnectEnd={onConnectEnd}
                onNodeClick={(e, node) => {
                  const target = e.target as HTMLElement
                  // Folders and tables are edited only via their hover edit icon
                  // (`.folder-edit` / `.table-edit`); a plain click just leaves the
                  // node draggable and never opens the editor.
                  if (node.id.startsWith('folder:')) {
                    if (target?.closest?.('.folder-edit')) {
                      const d = folders.find((dm) => `folder:${dm.id}` === node.id)
                      if (d) setEditingFolder(d)
                    }
                    return
                  }
                  if (target?.closest?.('.table-edit')) openTableEditor(node.id, !!node.data?.pending)
                }}
                onNodeContextMenu={(e, node) => {
                  e.preventDefault()
                  // Stop the event bubbling to the canvas' onContextMenu, which
                  // would otherwise also open the empty-space menu on top.
                  e.stopPropagation()
                  if (node.id.startsWith('folder:')) return
                  if (node.id.startsWith('note:')) {
                    setMenu(null)
                    setNoteMenu({ x: e.clientX, y: e.clientY, id: node.id.slice(5) })
                    return
                  }
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
                onNodeDoubleClick={(_, node) => {
                  // Notes are the only node you type into, and double-click is
                  // how you get there (a single click just selects/drags).
                  if (node.id.startsWith('note:')) setEditingNote(node.id.slice(5))
                }}
                onEdgeMouseEnter={(_, edge) => setHoveredEdge(edge.id)}
                onEdgeMouseLeave={() => setHoveredEdge(null)}
                onPaneClick={() => {
                  setEditingNote(null)
                  setSelectedNote(null)
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

              {/* An empty schema still gets the canvas: the grid, the pan/zoom
                  and the right-click menu are *how* the first table is made, so
                  the hint sits over them instead of replacing them with a
                  screen. `pointer-events-none` is the whole trick — the
                  right-click lands on the canvas underneath. */}
              {augmented.length === 0 && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                  <span className="rounded-soft border border-dashed border-edge-strong bg-panel/80 px-3 py-2 text-xs text-ink-faint">
                    No tables yet — right-click to create one.
                  </span>
                </div>
              )}

              {/* Zoom / fit controls — bottom-left of the canvas */}
              <div className="absolute bottom-3 left-3 z-10 flex items-center gap-0.5 rounded-soft border border-edge bg-elevated p-1">
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

      {editingDraft && (
        <CreateTablePanel
          conn={conn}
          initialTable={editingDraft.table}
          draftColumns={editingDraft.columns}
          onClose={() => setEditingDraft(null)}
          onStage={(statements, tableName) => replacePendingTable(editingDraft.table, statements, tableName)}
        />
      )}

      {editingFolder && (
        <TableFolderEditPanel
          folder={editingFolder}
          onSave={(fields) => onUpdateFolder?.(editingFolder.id, fields)}
          onDelete={() => onDeleteFolder?.(editingFolder.id)}
          onClose={() => setEditingFolder(null)}
        />
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
            onSaveDraft?.(pending, name, currentLayout())
            setNaming(false)
          }}
        />
      )}

      {/* Foreign-key info popup (shown on edge click) — for Postgres a
          committed FK gets delete + ON DELETE/UPDATE editing; a staged
          add/drop shows its pending status with an undo, when undoable. */}
      {edgePopup && (
        <div
          className="fixed z-[60] min-w-[200px] rounded-soft border border-edge-strong bg-elevated px-3 py-2.5"
          style={{ left: Math.min(edgePopup.x, window.innerWidth - 260), top: Math.min(edgePopup.y, window.innerHeight - 150) }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Foreign key</span>
            {edgePopup.fk.pendingFk && <Badge tone="amber" dense>staged add</Badge>}
            {edgePopup.fk.removed && <Badge tone="faint" dense>staged drop</Badge>}
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
          className="fixed z-[60] min-w-[240px] rounded-soft border border-edge-strong bg-elevated px-3 py-2.5"
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
              <Input
                className="!w-auto min-w-0 flex-1"
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
        <ContextMenu x={nodeMenu.x} y={nodeMenu.y} width={180} onClose={() => setNodeMenu(null)}>
          <div className="truncate px-2.5 pb-1.5 pt-1 text-[11px] font-semibold text-ink-dim">{nodeMenu.table}</div>
          <MenuItem disabled={nodeMenu.pending} onClick={() => { onOpenTable?.(nodeMenu.table); setNodeMenu(null) }}>
            <TableIcon width={14} height={14} /> Open in new tab
          </MenuItem>
          <MenuItem disabled={nodeMenu.pending} onClick={() => { onOpenSchema?.(nodeMenu.table); setNodeMenu(null) }}>
            <ColumnsIcon width={14} height={14} /> View table schema
          </MenuItem>
          <MenuItem onClick={() => { openTableEditor(nodeMenu.table, nodeMenu.pending); setNodeMenu(null) }}>
            <EditIcon width={14} height={14} /> Edit table
          </MenuItem>
          <MenuItem onClick={() => { onSetFolder?.(nodeMenu.table); setNodeMenu(null) }}>
            <FolderIcon width={14} height={14} /> Move to folder…
          </MenuItem>
          <div className="my-1 h-px bg-edge" />
          <MenuItem danger className="!text-red" onClick={() => { deleteTable(nodeMenu.table, nodeMenu.pending); setNodeMenu(null) }}>
            <TrashIcon width={14} height={14} /> Delete table
          </MenuItem>
        </ContextMenu>
      )}

      {/* Canvas right-click menu */}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} width={190} onClose={() => setMenu(null)}>
          <MenuItem onClick={() => { setCreating(true); setMenu(null) }}>
            <PlusIcon width={14} height={14} /> Create new Table
          </MenuItem>
          <MenuItem onClick={() => { addNote(menu.flow); setMenu(null) }}>
            <NoteIcon width={14} height={14} /> Add note
          </MenuItem>
          <div className="my-1 h-px bg-edge" />
          <ContextMenuSub label="Export" icon={DownloadIcon} width={170}>
            <ExportItems onExport={(f) => { runExport(f); setMenu(null) }} />
          </ContextMenuSub>
          <MenuItem onClick={() => { importRef.current?.click(); setMenu(null) }}>
            <UploadIcon width={14} height={14} /> Import design…
          </MenuItem>
          <MenuItem onClick={() => { autoLayout(); setMenu(null) }}>
            <WandIcon width={14} height={14} /> Auto arrange
          </MenuItem>
        </ContextMenu>
      )}

      {/* Note right-click menu — colour, edit, delete. A note has no panel of
          its own: everything about it is either typed into the note or picked
          here. */}
      {noteMenu && (
        <ContextMenu x={noteMenu.x} y={noteMenu.y} width={188} onClose={() => setNoteMenu(null)}>
          <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold text-ink-dim">Note</div>
          <div className="flex flex-wrap gap-1.5 px-2.5 pb-2">
            {NOTE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                className={`h-4 w-4 rounded-full border transition-transform hover:scale-110 ${
                  notes.find((n) => n.id === noteMenu.id)?.color === c ? 'border-ink' : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
                onClick={() => { updateNote(noteMenu.id, { color: c }); setNoteMenu(null) }}
              />
            ))}
          </div>
          <MenuItem onClick={() => { setEditingNote(noteMenu.id); setNoteMenu(null) }}>
            <EditIcon width={14} height={14} /> Edit text
          </MenuItem>
          <div className="my-1 h-px bg-edge" />
          <MenuItem danger className="!text-red" onClick={() => { deleteNote(noteMenu.id); setNoteMenu(null) }}>
            <TrashIcon width={14} height={14} /> Delete note
          </MenuItem>
        </ContextMenu>
      )}

      {/* Every statement, the database it is about to run against, and the one
          confirmation in front of it — see ReleaseDialog. */}
      {releaseOpen && releaseTarget && (
        <ReleaseDialog
          statements={pending.map((p) => p.sql)}
          target={releaseTarget}
          onCancel={() => setReleaseOpen(false)}
          onConfirm={() => {
            setReleaseOpen(false)
            // The layout travels with it: a host that clears the staged DDL once
            // it has run still has to keep where those tables were placed.
            onRelease?.(pending, currentLayout())
          }}
        />
      )}

      {/* Importing a design replaces everything the editor is holding, so it
          asks first — and says so when the file was written for another engine,
          which is a warning rather than a refusal (the DDL may still be fine). */}
      {importDoc && (
        <ConfirmDialog
          title={`Import “${importDoc.name}”?`}
          message={`This replaces the staged changes, the notes, the groups and every position in this diagram with the ones in the file (${importDoc.statements.length} statement${
            importDoc.statements.length === 1 ? '' : 's'
          }, ${importDoc.layout.notes.length} note${importDoc.layout.notes.length === 1 ? '' : 's'}).${
            importDoc.dialect && conn.type && importDoc.dialect !== conn.type
              ? ` It was designed for ${importDoc.dialect}, and this diagram targets ${conn.type}.`
              : ''
          }`}
          confirmLabel="Import"
          onCancel={() => setImportDoc(null)}
          onConfirm={applyImport}
        />
      )}
    </div>
  )
}
