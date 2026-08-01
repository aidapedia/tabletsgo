import { useEffect, useMemo, useState } from 'react'
import { getColumns, getTableData } from '@/shared/api/database'
import { useSettings } from '@/features/settings'
import { useShortcut } from '@/features/keymap'
import DataGrid, { cellText } from '@/features/workspace/components/DataGrid'
import RowEditorPanel from '@/features/workspace/components/RowEditorPanel'
import { EXPORT_FORMATS, downloadRows, sqlValue, toCsv, toJson } from '@/features/workspace/lib/exportRows'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import Segmented from '@/shared/ui/form/Segmented'
import Checkbox from '@/shared/ui/form/Checkbox'
import Popover from '@/shared/ui/overlay/Popover'
import ContextMenu, { ContextMenuSub } from '@/shared/ui/overlay/ContextMenu'
import Select from '@/shared/ui/form/Select'
import { useToast } from '@/shared/ui/feedback/Toast'
import {
  ChevronLeft,
  ChevronRight,
  CloseIcon,
  ColumnsIcon,
  CopyIcon,
  DownloadIcon,
  EditIcon,
  EyeIcon,
  FilterIcon,
  PlusSmall,
  RefreshIcon,
  SaveIcon,
  SortIcon,
  TrashIcon,
} from '@/shared/ui/icons'

const NUMERIC_TYPE = /(int|serial|numeric|decimal|real|double|float)/i

// Hidden field the table read attaches on tables with no primary key, holding
// the row's physical id (Postgres ctid / SQLite rowid). It is not part of
// `columns`, so it never renders, exports, or lands in an INSERT — it only
// identifies the exact row an edit targets. Keep in sync with server.js.
const ROW_ID_COLUMN = '__tg_rowid'

const OPERATORS = [
  { value: 'contains', label: 'contains' },
  { value: '=', label: '=' },
  { value: '!=', label: '≠' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '≥' },
  { value: '<=', label: '≤' },
  { value: 'isnull', label: 'is null' },
  { value: 'notnull', label: 'is not null' },
]
export const PAGE_SIZES = [25, 50, 100, 200]

const ctl =
  'rounded-soft border border-edge bg-bg px-2.5 py-1.5 text-[11px] text-ink outline-none focus:border-green-dim'

let filterId = 0
export const makeFilter = (col = '', op = 'contains', value = '') => ({ id: `f${++filterId}`, col, op, value, enabled: true })
const blankFilter = () => makeFilter()

export function matchFilter(row, f) {
  if (!f.enabled || !f.col) return true
  if (f.op !== 'isnull' && f.op !== 'notnull' && f.value === '') return true
  const raw = row[f.col]
  const v = raw == null ? '' : String(raw)
  switch (f.op) {
    case '=': return v === f.value
    case '!=': return v !== f.value
    case 'contains': return v.toLowerCase().includes(f.value.toLowerCase())
    case '>': return Number(raw) > Number(f.value)
    case '<': return Number(raw) < Number(f.value)
    case '>=': return Number(raw) >= Number(f.value)
    case '<=': return Number(raw) <= Number(f.value)
    case 'isnull': return raw == null
    case 'notnull': return raw != null
    default: return true
  }
}

// Multi-rule client-side sort shared by the data grid + history views. Rules
// apply in priority order (first = primary); nulls always sort last. Numeric
// when both values parse as numbers, else locale string compare. Returns the
// input untouched when there are no active rules.
export function sortRows(rows, sort) {
  const rules = (sort || []).filter((s) => s.col && s.enabled !== false)
  if (!rules.length) return rows
  return [...rows].sort((a, b) => {
    for (const { col, dir } of rules) {
      const x = a[col]
      const y = b[col]
      if (x == null && y == null) continue
      if (x == null) return 1
      if (y == null) return -1
      const nx = Number(x)
      const ny = Number(y)
      const c = !isNaN(nx) && !isNaN(ny) ? nx - ny : String(x).localeCompare(String(y))
      if (c !== 0) return dir === 'desc' ? -c : c
    }
    return 0
  })
}

// Reducer for a header click on `col`. Plain click = single-column sort cycling
// asc → desc → off. Shift (additive) = add/toggle this column within the
// multi-sort (asc → desc → removed), preserving the other rules and their order.
// A rule the user disabled in the panel is re-enabled by the click that would
// otherwise start its cycle — a header click always means "sort by this now".
export function cycleSortRules(prev, col, additive) {
  const existing = prev.find((s) => s.col === col)
  const disabled = existing && existing.enabled === false
  if (additive) {
    if (!existing) return [...prev, makeSort(col, 'asc')]
    if (disabled) return prev.map((s) => (s.col === col ? { ...s, enabled: true } : s))
    if (existing.dir === 'asc') return prev.map((s) => (s.col === col ? { ...s, dir: 'desc' } : s))
    return prev.filter((s) => s.col !== col)
  }
  if (existing && prev.length === 1) {
    if (disabled) return [{ ...existing, enabled: true }]
    return existing.dir === 'asc' ? [makeSort(col, 'desc')] : []
  }
  return [makeSort(col, 'asc')]
}

// `filters` is owned by the parent tab so it survives the unmount that happens
// when the user switches tabs (only the active tab is mounted).
export default function TableView({ conn, table, onChange, onOpenReference, filters, onFiltersChange }) {
  const toast = useToast()
  const { tableRowLimit, directExecute } = useSettings()
  // With Direct execute on, the parent runs the change immediately and toasts
  // the result, so the "added to changes" confirmations here would be misleading.
  const stagedInfo = (msg) => {
    if (!directExecute) toast.info(msg)
  }
  const [columns, setColumns] = useState([])
  const [rows, setRows] = useState([])
  const [pkCols, setPkCols] = useState([])
  const [colTypes, setColTypes] = useState({}) // { colName: sqlType } for the editor
  const [colRefs, setColRefs] = useState({}) // { colName: { table, column } } FK targets
  const [colDefaults, setColDefaults] = useState({}) // { colName: rawDefaultSql | null }
  const [colMeta, setColMeta] = useState([]) // full getColumns() rows — for the Inspector
  const [loading, setLoading] = useState(true)
  const [showInsert, setShowInsert] = useState(false)
  const [selected, setSelected] = useState(() => new Set()) // row keys
  const [edits, setEdits] = useState<Record<string, { where: string; values: Record<string, any> }>>({}) // unsaved inline edits: { rowKey: { where, values } }
  const [cellMenu, setCellMenu] = useState(null) // right-click cell menu: { x, y, row, col, value }
  const [inspecting, setInspecting] = useState(null) // row object shown in the Inspector slide-over

  const [sort, setSort] = useState([]) // [{ col, dir, enabled }] — ordered sort rules (first = primary)
  const [hidden, setHidden] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const load = async () => {
    setLoading(true)
    const [result, meta] = await Promise.all([getTableData(conn, table, tableRowLimit), getColumns(conn, table)])
    setColumns(result.columns || [])
    setRows(result.rows || [])
    setPkCols((meta || []).filter((c) => c.pk).map((c) => c.name))
    setColTypes(Object.fromEntries((meta || []).map((c) => [c.name, c.type])))
    setColRefs(Object.fromEntries((meta || []).filter((c) => c.references).map((c) => [c.name, c.references])))
    setColDefaults(Object.fromEntries((meta || []).map((c) => [c.name, c.default ?? null])))
    setColMeta(meta || [])
    setSelected(new Set())
    setEdits({})
    setLoading(false)
  }

  useEffect(() => {
    setSort([])
    setHidden([])
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, table])

  // Any filter change (local edit, or a new FK drill-down into this same tab)
  // puts us back on the first page.
  useEffect(() => setPage(1), [filters])

  // Rows are targeted by primary key when available. Without one, the read
  // carries the physical row id (Postgres ctid / SQLite rowid) in a hidden
  // field and we target that. Only if even that is missing (a view) do we fall
  // back to matching every column — which never matches when a value doesn't
  // round-trip (JSON, floats, timestamps) and hits *every* duplicate when the
  // table has identical rows.
  const identCols = pkCols.length ? pkCols : columns
  const rowIdRef = conn.type === 'postgresql' ? 'ctid' : 'rowid'
  const hasRowId = !pkCols.length && rows.length > 0 && rows[0][ROW_ID_COLUMN] != null
  const selectable = columns.length > 0
  const rowKey = (row) =>
    hasRowId ? String(row[ROW_ID_COLUMN]) : identCols.map((c) => String(row[c])).join('¦')
  const rowWhere = (row) =>
    hasRowId
      ? `${rowIdRef} = ${sqlValue(row[ROW_ID_COLUMN])}`
      : identCols.map((c) => (row[c] == null ? `"${c}" IS NULL` : `"${c}" = ${sqlValue(row[c])}`)).join(' AND ')

  const filtered = useMemo(() => rows.filter((r) => filters.every((f) => matchFilter(r, f))), [rows, filters])

  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort])

  const visibleColumns = useMemo(() => columns.filter((c) => !hidden.includes(c)), [columns, hidden])

  // Header click sorting. Plain click = single-column sort cycling asc → desc →
  // off. Shift+click = add/toggle this column within the multi-sort (asc → desc
  // → removed), keeping the other rules and their priority order.
  const cycleSort = (col, additive) => {
    setSort((prev) => cycleSortRules(prev, col, additive))
    setPage(1)
  }

  const total = sorted.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  useEffect(() => setPage((p) => Math.min(Math.max(1, p), pageCount)), [pageCount])
  const pageRows = useMemo(() => sorted.slice((page - 1) * pageSize, page * pageSize), [sorted, page, pageSize])

  const activeFilterCount = filters.filter((f) => f.enabled && f.col && f.value !== '').length
  const activeSortCount = sort.filter((s) => s.col && s.enabled !== false).length

  // Exports what the grid currently shows: visible columns, filtered + sorted rows.
  const exportAs = (format) => downloadRows(format, { columns: visibleColumns, rows: sorted, table })

  const toggleColumn = (c) =>
    setHidden((h) => (h.includes(c) ? h.filter((x) => x !== c) : [...h, c]))

  // ---- Row selection + bulk actions ----
  const toggleRow = (row) => {
    const k = rowKey(row)
    setSelected((s) => {
      const n = new Set(s)
      n.has(k) ? n.delete(k) : n.add(k)
      return n
    })
  }
  const toggleAll = () => {
    setSelected((s) => {
      const allOnPage = pageRows.length > 0 && pageRows.every((r) => s.has(rowKey(r)))
      const n = new Set(s)
      pageRows.forEach((r) => (allOnPage ? n.delete(rowKey(r)) : n.add(rowKey(r))))
      return n
    })
  }
  const clearSelection = () => setSelected(new Set())
  const selectedRows = () => rows.filter((r) => selected.has(rowKey(r)))

  const insertSql = (values) => {
    const cols = Object.keys(values)
    return `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols
      .map((c) => sqlValue(values[c]))
      .join(', ')})`
  }

  // Actions stage SQL into Changes; nothing executes until the user commits.
  // `clear` skips clearSelection() for single-row actions fired from the cell
  // context menu, so right-clicking a row never disturbs an unrelated bulk selection.
  const stageDelete = (targets, { clear = true } = {}) => {
    if (!targets.length) return
    const sql = `DELETE FROM "${table}" WHERE ${targets.map((r) => `(${rowWhere(r)})`).join(' OR ')}`
    onChange?.({ kind: 'delete', label: `Delete ${targets.length} row(s)`, sql, table })
    stagedInfo(`Added delete to changes — commit to apply.`)
    if (clear) clearSelection()
  }
  const deleteSelected = () => stageDelete(selectedRows())

  const stageDuplicate = (targets, { clear = true } = {}) => {
    if (!targets.length) return
    for (const row of targets) {
      const values = {}
      for (const c of columns) if (!pkCols.includes(c)) values[c] = row[c]
      onChange?.({ kind: 'duplicate', label: 'Duplicate row', sql: insertSql(values), table })
    }
    stagedInfo(`Added ${targets.length} insert(s) to changes — commit to apply.`)
    if (clear) clearSelection()
  }
  const duplicateSelected = () => stageDuplicate(selectedRows())

  const stageInsert = (values) => {
    onChange?.({ kind: 'insert', label: 'Insert row', sql: insertSql(values), table })
    stagedInfo('Added insert to changes — commit to apply.')
  }

  // Cell context-menu actions. `sel` is the grid's rectangular cell selection
  // (always at least the right-clicked cell), so one code path covers both a
  // single cell and a dragged block: one UPDATE per row, every selected column.
  const setCellsAs = (sel, mode) => {
    const expr = (col) => (mode === 'default' ? colDefaults[col] : mode === 'null' ? 'NULL' : sqlValue(''))
    let staged = 0
    for (const row of sel.rows) {
      const parts = sel.columns.filter((c) => expr(c) != null).map((c) => `"${c}" = ${expr(c)}`)
      if (!parts.length) continue
      onChange?.({
        kind: 'update',
        label: `Set ${sel.columns.join(', ')} to ${mode.toUpperCase()}`,
        sql: `UPDATE "${table}" SET ${parts.join(', ')} WHERE ${rowWhere(row)}`,
        table,
      })
      staged++
    }
    if (staged) stagedInfo(`Added ${staged} update(s) to changes — commit to apply.`)
  }

  const copyText = async (text, label = 'Copied to clipboard') => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(label)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }
  // Serialize a cell selection. TSV is the default (what spreadsheets expect);
  // CSV/JSON keep only the selected columns, so the text mirrors the block.
  const selectionText = (sel, format) => {
    if (format === 'tsv') {
      return sel.values.map((vals) => vals.map((v) => cellText(v).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n')
    }
    const objs = sel.values.map((vals) => Object.fromEntries(sel.columns.map((c, k) => [c, vals[k]])))
    return format === 'json' ? toJson(sel.columns, objs) : toCsv(sel.columns, objs)
  }

  const addQuickFilter = (col, op, value) => {
    onFiltersChange([...filters, makeFilter(col, op, op === 'isnull' || op === 'notnull' ? '' : cellText(value))])
  }

  // Inline cell edit → held locally as an unsaved edit (not staged yet).
  const editCell = (row, col, value) => {
    const k = rowKey(row)
    setEdits((e) => {
      const cur = e[k] || { where: rowWhere(row), values: {} }
      const values = { ...cur.values }
      // Editing back to the original value clears the pending edit for that cell.
      if (String(row[col] ?? '') === String(value)) delete values[col]
      else values[col] = value
      const next = { ...e }
      if (Object.keys(values).length === 0) delete next[k]
      else next[k] = { where: cur.where, values }
      return next
    })
  }

  // Cell overlay the grid renders (rowKey -> { col: value }).
  const editOverlay = useMemo(() => {
    const o = {}
    for (const [k, { values }] of Object.entries(edits)) o[k] = values
    return o
  }, [edits])
  const editCount = useMemo(
    () => Object.values(edits).reduce((n, e) => n + Object.keys(e.values).length, 0),
    [edits]
  )

  // Save all pending edits → one UPDATE per row, added to staged changes.
  const saveEdits = () => {
    const entries = Object.values(edits)
    if (!entries.length) return
    for (const { where, values } of entries) {
      const setClause = Object.entries(values)
        .map(([c, v]) => `"${c}" = ${v === '' ? 'NULL' : sqlValue(v)}`)
        .join(', ')
      onChange?.({ kind: 'update', label: `Update row in ${table}`, sql: `UPDATE "${table}" SET ${setClause} WHERE ${where}`, table })
    }
    setEdits({})
    stagedInfo(`Added ${entries.length} update(s) to changes — commit to apply.`)
  }
  const discardEdits = () => setEdits({})

  const handleCellContextMenu = (e, { row, col, value, selection }) => {
    setCellMenu({ x: e.clientX, y: e.clientY, row, col, value, selection })
  }

  useShortcut('workspace.newRow', () => setShowInsert(true))
  useShortcut('workspace.deleteSelected', deleteSelected)
  useShortcut('workspace.duplicateSelected', duplicateSelected)
  useShortcut('workspace.discardEdits', discardEdits)
  useShortcut('general.save', saveEdits)
  useShortcut('workspace.exportCsv', () => exportAs('csv'))
  useShortcut('workspace.refresh', load)

  const selCount = selected.size

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Toolbar / action list — the left actions swap to Save/Discard while
          there are unsaved cell edits, or to bulk actions while rows are
          selected; the right cluster (columns, pagination, page size) stays
          visible in every state. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        {editCount > 0 ? (
          <>
            <Button variant="primary" size="sm" icon={SaveIcon} onClick={saveEdits}>
              Save
            </Button>
            <Button variant="subtle" size="sm" onClick={discardEdits}>
              Discard
            </Button>

            <div className="mx-0.5 h-5 w-px bg-edge" />

            <span className="text-[11px] font-semibold text-amber">
              {editCount} unsaved edit{editCount > 1 ? 's' : ''}
            </span>
          </>
        ) : selCount > 0 ? (
          <>
            <Button variant="primary" size="sm" icon={TrashIcon} onClick={deleteSelected}
              className="!bg-red !text-white hover:!bg-red/90">
              Delete
            </Button>
            <Button variant="subtle" size="sm" icon={CopyIcon} onClick={duplicateSelected}>
              Duplicate
            </Button>

            <div className="mx-0.5 h-5 w-px bg-edge" />

            <span className="text-[11px] font-semibold text-ink">{selCount} selected</span>

            <Button variant="subtle" size="sm" className="!px-2" onClick={clearSelection} aria-label="Clear selection">
              <CloseIcon width={16} height={16} />
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" size="sm" icon={PlusSmall} onClick={() => setShowInsert(true)} disabled={loading}>
              Insert
            </Button>
            <Button variant="subtle" size="sm" icon={RefreshIcon} onClick={load} disabled={loading}>
              Refresh
            </Button>

            <div className="mx-0.5 h-5 w-px bg-edge" />

        <Popover
          width={412}
          trigger={({ open, toggle }) => (
            <Button variant="subtle" size="sm" icon={FilterIcon} active={open || activeFilterCount > 0} onClick={toggle}>
              {activeFilterCount > 0 ? `Filtered by ${activeFilterCount} rule${activeFilterCount > 1 ? 's' : ''}` : 'Filter'}
            </Button>
          )}
        >
          {({ close }) => (
            <FilterPanel
              columns={columns}
              initial={filters}
              onApply={onFiltersChange}
              onClose={close}
            />
          )}
        </Popover>

        <Popover
          width={400}
          trigger={({ open, toggle }) => (
            <Button variant="subtle" size="sm" icon={SortIcon} active={open || activeSortCount > 0} onClick={toggle}>
              {activeSortCount > 0 ? `Sorted by ${activeSortCount} rule${activeSortCount > 1 ? 's' : ''}` : 'Sort'}
            </Button>
          )}
        >
          {({ close }) => (
            <SortPanel
              columns={columns}
              initial={sort}
              onApply={(s) => {
                setSort(s)
                setPage(1)
              }}
              onClose={close}
            />
          )}
        </Popover>

            <Popover
              width={150}
              trigger={({ open, toggle }) => (
                <Button
                  variant="subtle"
                  size="sm"
                  icon={DownloadIcon}
                  chevron
                  active={open}
                  onClick={toggle}
                  disabled={!sorted.length}
                >
                  Export
                </Button>
              )}
            >
              {({ close }) => (
                <div className="p-1">
                  {EXPORT_FORMATS.map((f) => (
                    <MenuItem
                      key={f.id}
                      onClick={() => {
                        exportAs(f.id)
                        close()
                      }}
                    >
                      <DownloadIcon width={14} height={14} /> {f.label}
                    </MenuItem>
                  ))}
                </div>
              )}
            </Popover>
          </>
        )}

        {/* Right cluster — columns / pagination / page size — always visible */}
        <div className="ml-auto flex items-center gap-1">
          <Popover
            align="right"
            width={220}
            trigger={({ open, toggle }) => (
              <Button variant="subtle" size="sm" active={open} onClick={toggle} className="!px-2" aria-label="Toggle columns">
                <ColumnsIcon width={15} height={15} />
              </Button>
            )}
          >
            <ColumnsPanel columns={columns} hidden={hidden} onToggle={toggleColumn} />
          </Popover>

          <div className="mx-0.5 h-5 w-px bg-edge" />

          <Button
            variant="subtle"
            size="sm"
            className="!px-2"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            aria-label="Previous page"
          >
            <ChevronLeft width={16} height={16} />
          </Button>
          <span className="px-1 text-[11px] text-ink">
            {page} <span className="text-ink-faint">of {pageCount}</span>
          </span>
          <Button
            variant="subtle"
            size="sm"
            className="!px-2"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            aria-label="Next page"
          >
            <ChevronRight width={16} height={16} />
          </Button>

          <Popover
            align="right"
            width={120}
            trigger={({ open, toggle }) => (
              <Button variant="subtle" size="sm" chevron active={open} onClick={toggle}>
                {pageSize} rows
              </Button>
            )}
          >
            {({ close }) => (
              <div className="p-1">
                {PAGE_SIZES.map((s) => (
                  <MenuItem
                    key={s}
                    onClick={() => {
                      setPageSize(s)
                      setPage(1)
                      close()
                    }}
                  >
                    {s} rows
                  </MenuItem>
                ))}
              </div>
            )}
          </Popover>

          <span className="pl-1 text-[11px] text-ink-faint">{total} rows</span>
        </div>
      </div>

      {loading ? (
        <div className="p-5 text-center text-xs">Loading…</div>
      ) : (
        <DataGrid
          columns={visibleColumns}
          rows={pageRows}
          columnTypes={colTypes}
          columnRefs={colRefs}
          onOpenReference={onOpenReference}
          selectable={selectable}
          getRowKey={rowKey}
          selectedKeys={selected}
          onToggleRow={toggleRow}
          onToggleAll={toggleAll}
          editable={selectable}
          edits={editOverlay}
          onEdit={editCell}
          onCellContextMenu={handleCellContextMenu}
          sort={sort}
          onSort={cycleSort}
        />
      )}

      {showInsert && (
        <RowEditorPanel
          title="Insert New Row"
          submitLabel="Add to changes"
          columns={colMeta}
          loading={loading}
          onClose={() => setShowInsert(false)}
          onStage={(values) => {
            stageInsert(values)
            setShowInsert(false)
          }}
        />
      )}

      {inspecting && (
        <RowEditorPanel
          title="Inspector"
          submitLabel="Save changes"
          row={inspecting}
          columns={colMeta}
          onClose={() => setInspecting(null)}
          onStage={(diff) => {
            if (!Object.keys(diff).length) return
            const setClause = Object.entries(diff).map(([c, v]) => `"${c}" = ${sqlValue(v)}`).join(', ')
            onChange?.({
              kind: 'update',
              label: `Update row in ${table}`,
              sql: `UPDATE "${table}" SET ${setClause} WHERE ${rowWhere(inspecting)}`,
              table,
            })
            stagedInfo('Added update to changes — commit to apply.')
            // Must close explicitly: useSlideOver runs this commit *instead of*
            // onClose, so the invisible overlay would stay mounted and swallow
            // every click.
            setInspecting(null)
          }}
        />
      )}

      {cellMenu &&
        (() => {
          const { row, col, value } = cellMenu
          const isNum = NUMERIC_TYPE.test(colTypes[col] || '')
          // Always a rectangle — a lone right-clicked cell is a 1×1 selection.
          const sel = cellMenu.selection || { rows: [row], columns: [col], values: [[value]], cellCount: 1 }
          const multi = sel.cellCount > 1
          const selLabel = multi ? `${sel.cellCount} cells` : 'cell value'
          const rowLabel = sel.rows.length > 1 ? `${sel.rows.length} rows` : 'row'
          return (
            <ContextMenu x={cellMenu.x} y={cellMenu.y} onClose={() => setCellMenu(null)}>
              <ContextMenuSub label="Filter by this column" icon={FilterIcon}>
                <MenuItem onClick={() => { addQuickFilter(col, '=', value); setCellMenu(null) }}>equals</MenuItem>
                <MenuItem onClick={() => { addQuickFilter(col, '!=', value); setCellMenu(null) }}>not equals</MenuItem>
                {isNum ? (
                  <>
                    <MenuItem onClick={() => { addQuickFilter(col, '>', value); setCellMenu(null) }}>greater than</MenuItem>
                    <MenuItem onClick={() => { addQuickFilter(col, '<', value); setCellMenu(null) }}>less than</MenuItem>
                  </>
                ) : (
                  <MenuItem onClick={() => { addQuickFilter(col, 'contains', value); setCellMenu(null) }}>contains</MenuItem>
                )}
                <div className="my-1 h-px bg-edge" />
                <MenuItem onClick={() => { addQuickFilter(col, 'isnull', ''); setCellMenu(null) }}>is null</MenuItem>
                <MenuItem onClick={() => { addQuickFilter(col, 'notnull', ''); setCellMenu(null) }}>is not null</MenuItem>
              </ContextMenuSub>
              <ContextMenuSub label={multi ? `Set ${sel.cellCount} cells as` : 'Set as'} icon={EditIcon}>
                <MenuItem onClick={() => { setCellsAs(sel, 'null'); setCellMenu(null) }}>NULL</MenuItem>
                <MenuItem onClick={() => { setCellsAs(sel, 'empty'); setCellMenu(null) }}>EMPTY</MenuItem>
                <MenuItem
                  disabled={sel.columns.every((c) => colDefaults[c] == null)}
                  onClick={() => { setCellsAs(sel, 'default'); setCellMenu(null) }}
                >
                  DEFAULT
                </MenuItem>
              </ContextMenuSub>

              <MenuItem
                onClick={() => {
                  copyText(multi ? selectionText(sel, 'tsv') : cellText(value), `Copied ${selLabel}`)
                  setCellMenu(null)
                }}
              >
                <CopyIcon width={14} height={14} /> Copy {selLabel}
              </MenuItem>
              {multi && (
                <ContextMenuSub label="Copy selection as" icon={CopyIcon}>
                  <MenuItem onClick={() => { copyText(selectionText(sel, 'csv'), 'Copied CSV'); setCellMenu(null) }}>CSV</MenuItem>
                  <MenuItem onClick={() => { copyText(selectionText(sel, 'json'), 'Copied JSON'); setCellMenu(null) }}>JSON</MenuItem>
                </ContextMenuSub>
              )}
              <ContextMenuSub label={`Copy ${rowLabel} as`} icon={CopyIcon}>
                <MenuItem onClick={() => { copyText(sel.rows.map(insertSql).join('\n'), 'Copied SQL'); setCellMenu(null) }}>SQL</MenuItem>
                <MenuItem onClick={() => { copyText(toCsv(columns, sel.rows), 'Copied CSV'); setCellMenu(null) }}>CSV</MenuItem>
                <MenuItem onClick={() => { copyText(JSON.stringify(sel.rows.length > 1 ? sel.rows : row, null, 2), 'Copied JSON'); setCellMenu(null) }}>JSON</MenuItem>
              </ContextMenuSub>

              <div className="my-1 h-px bg-edge" />
              
              <MenuItem onClick={() => { setInspecting(row); setCellMenu(null) }}>
                <EyeIcon width={14} height={14} /> Open Inspector
              </MenuItem>
              <MenuItem onClick={() => { setShowInsert(true); setCellMenu(null) }}>
                <PlusSmall width={14} height={14} /> Insert row
              </MenuItem>
              <MenuItem onClick={() => { stageDuplicate(sel.rows, { clear: false }); setCellMenu(null) }}>
                <CopyIcon width={14} height={14} /> Duplicate {rowLabel}
              </MenuItem>

              <div className="my-1 h-px bg-edge" />
              <MenuItem danger onClick={() => { stageDelete(sel.rows, { clear: false }); setCellMenu(null) }}>
                <TrashIcon width={14} height={14} /> Delete {rowLabel}
              </MenuItem>
              
            </ContextMenu>
          )
        })()}
    </div>
  )
}

const GripIcon = (props) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden {...props}>
    <circle cx="4" cy="3" r="1" /><circle cx="8" cy="3" r="1" />
    <circle cx="4" cy="6" r="1" /><circle cx="8" cy="6" r="1" />
    <circle cx="4" cy="9" r="1" /><circle cx="8" cy="9" r="1" />
  </svg>
)

// Drag-to-reorder shared by the filter + sort rule lists: a dragged rule takes
// the slot of whichever rule it's hovering. Spread `rowProps(id)` on the rule
// row and `handleProps(id)` on its grip; `dragId` fades the row being moved.
function useRuleReorder(setDraft) {
  const [dragId, setDragId] = useState(null)
  const moveOnto = (targetId) => {
    if (!dragId || dragId === targetId) return
    setDraft((d) => {
      const from = d.findIndex((x) => x.id === dragId)
      const to = d.findIndex((x) => x.id === targetId)
      if (from < 0 || to < 0) return d
      const next = [...d]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }
  return {
    dragId,
    rowProps: (id) => ({ onDragOver: (e) => { e.preventDefault(); moveOnto(id) } }),
    handleProps: (id) => ({ draggable: true, onDragStart: () => setDragId(id), onDragEnd: () => setDragId(null) }),
  }
}

const DragHandle = (props) => (
  <span
    className="flex shrink-0 cursor-grab items-center text-ink-faint hover:text-ink active:cursor-grabbing"
    aria-label="Drag to reorder"
    title="Drag to reorder"
    {...props}
  >
    <GripIcon />
  </span>
)

export function FilterPanel({ columns, initial, onApply, onClose }) {
  const [draft, setDraft] = useState(() => (initial.length ? initial.map((f) => ({ ...f })) : [blankFilter()]))
  const { dragId, rowProps, handleProps } = useRuleReorder(setDraft)
  const update = (id, patch) => setDraft((d) => d.map((f) => (f.id === id ? { ...f, ...patch } : f)))

  return (
    <div className="p-3">
      <div className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-ink">
        <FilterIcon className="text-ink-dim" /> Filter Data
      </div>

      <div className="flex flex-col gap-2">
        {draft.map((f) => (
          <div
            key={f.id}
            {...rowProps(f.id)}
            className={`flex items-center gap-1.5 ${dragId === f.id ? 'opacity-40' : ''}`}
          >
            <DragHandle {...handleProps(f.id)} />
            <Checkbox
              checked={f.enabled}
              onChange={(v) => update(f.id, { enabled: v })}
              ariaLabel="Enable filter"
            />
            <Select
              className={`${ctl} min-w-0 flex-1`}
              value={f.col}
              onChange={(v) => update(f.id, { col: v })}
              placeholder="Column…"
              options={[{ value: '', label: 'Column…' }, ...columns.map((c) => ({ value: c, label: c }))]}
            />
            <Select
              className={`${ctl} w-[92px]`}
              value={f.op}
              onChange={(v) => update(f.id, { op: v })}
              options={OPERATORS}
            />
            <input
              className={`${ctl} w-[96px]`}
              placeholder="Value…"
              value={f.value}
              onChange={(e) => update(f.id, { value: e.target.value })}
            />
            <TextButton
              tone="faint"
              className="shrink-0 hover:!text-red"
              onClick={() => setDraft((d) => (d.length > 1 ? d.filter((x) => x.id !== f.id) : [blankFilter()]))}
              aria-label="Remove filter"
            >
              <CloseIcon width={14} height={14} />
            </TextButton>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <Button variant="subtle" size="sm" icon={PlusSmall} onClick={() => setDraft((d) => [...d, blankFilter()])}>
          Add Filter
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              onApply(draft)
              onClose()
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  )
}

let sortId = 0
export const makeSort = (col = '', dir = 'asc') => ({ id: `s${++sortId}`, col, dir, enabled: true })
const blankSort = () => makeSort()

export function SortPanel({ columns, initial, onApply, onClose }) {
  const [draft, setDraft] = useState(() => (initial.length ? initial.map((s) => ({ ...s })) : [blankSort()]))
  const { dragId, rowProps, handleProps } = useRuleReorder(setDraft)
  const update = (id, patch) => setDraft((d) => d.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  return (
    <div className="p-3">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-ink">
        <SortIcon className="text-ink-dim" /> Sort Data
      </div>

      <div className="flex flex-col gap-2">
        {draft.map((s, i) => (
          <div
            key={s.id}
            {...rowProps(s.id)}
            className={`flex items-center gap-1.5 ${dragId === s.id ? 'opacity-40' : ''}`}
          >
            <DragHandle {...handleProps(s.id)} />
            <Checkbox
              checked={s.enabled !== false}
              onChange={(v) => update(s.id, { enabled: v })}
              ariaLabel="Enable sort"
            />
            <Select
              className={`${ctl} min-w-0 flex-1`}
              value={s.col}
              onChange={(v) => update(s.id, { col: v })}
              placeholder="Column…"
              options={[{ value: '', label: 'Column…' }, ...columns.map((c) => ({ value: c, label: c }))]}
            />
            <Segmented
              className="shrink-0"
              value={s.dir}
              onChange={(v) => update(s.id, { dir: v })}
              options={[
                { value: 'asc', label: 'Asc' },
                { value: 'desc', label: 'Desc' },
              ]}
            />
            <TextButton
              tone="faint"
              className="shrink-0 hover:!text-red"
              onClick={() => setDraft((d) => (d.length > 1 ? d.filter((x) => x.id !== s.id) : [blankSort()]))}
              aria-label="Remove sort"
            >
              <CloseIcon width={14} height={14} />
            </TextButton>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <Button variant="subtle" size="sm" icon={PlusSmall} onClick={() => setDraft((d) => [...d, blankSort()])}>
          Add Sort
        </Button>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onApply([])
              onClose()
            }}
          >
            Clear
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              onApply(draft.filter((s) => s.col))
              onClose()
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  )
}

export function ColumnsPanel({ columns, hidden, onToggle }) {
  return (
    <div className="max-h-[300px] overflow-y-auto p-2">
      <div className="px-1.5 pb-1.5 text-[11px] font-semibold text-ink-dim">Toggle columns</div>
      {columns.map((c) => (
        <div
          key={c}
          onClick={() => onToggle(c)}
          className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-[11px] text-ink-dim hover:bg-card-hover hover:text-ink"
        >
          <Checkbox checked={!hidden.includes(c)} onChange={() => onToggle(c)} ariaLabel={`Toggle ${c}`} />
          <span className="truncate">{c}</span>
        </div>
      ))}
    </div>
  )
}
