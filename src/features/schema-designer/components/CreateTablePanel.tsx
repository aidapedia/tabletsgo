import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { getColumns, getIndexes, getSchema } from '@/shared/api/database'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import DragHandle from '@/shared/ui/DragHandle'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import Segmented from '@/shared/ui/form/Segmented'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { useDragReorder } from '@/shared/hooks/useDragReorder'
import { splitStatements } from '@/shared/lib/schemaDraft'
import { moveColumn } from '@/features/schema-designer/lib/design'
import { PlusIcon } from '@/shared/ui/icons'
import { Input } from '@/shared/ui/form/Input'
import { FormField, Label } from '@/shared/ui/form/Form'
import { ColumnField, colDef, tableDefLines, newColumn, useColumnTypes } from '@/features/schema-designer/components/columnFields'
import IndexEditor, { useIndexEditor } from '@/features/schema-designer/components/indexFields'
import { parseCreateIndex } from '@/features/schema-designer/lib/indexes'

// CodeMirror only loads when someone opens the SQL view — this panel is in the
// feature barrel, so a static import would drag the editor into every chunk
// that merely lists schemas.
const SqlEditor = lazy(() => import('@/shared/ui/SqlEditor'))

// Columns, indexes and the raw DDL are three views of one form, not three
// sections stacked down the panel: a table's columns already fill it, so its
// indexes would sit below the fold every time. Submitting stages what every
// view has built, whichever one is open.
const views = (indexCount) => [
  { value: 'fields', label: 'Columns' },
  { value: 'indexes', label: indexCount ? `Indexes · ${indexCount}` : 'Indexes' },
  { value: 'sql', label: 'SQL' },
]

const createTableSql = (tableName, cols) =>
  `CREATE TABLE "${tableName}" (\n  ${tableDefLines(cols).join(',\n  ')}\n);`

// Whitespace-insensitive comparison — enough to tell "the form could have
// written this" from "someone wrote this by hand".
const norm = (sql) => (sql || '').replace(/\s+/g, ' ').trim()

// Which table a hand-written batch is about, so the staged items file under the
// right name on the diagram. First statement that names one wins.
const tableNameIn = (statements) => {
  for (const sql of statements) {
    const m = sql.match(/^\s*(?:CREATE TABLE|ALTER TABLE|DROP TABLE)\s+(?:IF (?:NOT )?EXISTS\s+)?"([^"]+)"/i)
    if (m) return m[1]
  }
  return ''
}

/**
 * Three modes, all sharing one form:
 * - create (default): stages a CREATE TABLE for a brand-new table.
 * - edit (`initialTable`): a committed table — columns load from the live
 *   schema and only ADD COLUMN is stageable.
 * - draft (`draftColumns`): a table whose CREATE TABLE is still staged and
 *   uncommitted, so everything (name included) is still freely editable and
 *   submitting restages the whole CREATE.
 *
 * Each of those is written either as Fields (the form) or as SQL (the DDL the
 * form builds, editable by hand) — see `view`.
 */
export default function CreateTablePanel({ conn, initialTable, draftColumns, draftIndexSql = [], draftSql, onClose, onStage }: any) {
  const dialect = conn.type === 'postgresql' ? 'postgresql' : 'sqlite'
  const types = useColumnTypes(conn)
  const defaultType = dialect === 'postgresql' ? 'serial' : 'INTEGER'
  const isDraft = !!draftColumns
  const isEdit = !!initialTable && !isDraft

  const { show, close } = useSlideOver(onClose)
  const [name, setName] = useState(initialTable || '')
  const [columns, setColumns] = useState(() =>
    isDraft ? draftColumns : isEdit ? [] : [{ ...newColumn(defaultType), name: 'id', pk: true }]
  )
  const [schema, setSchema] = useState({})
  // The table's current indexes. `null` while the read is in flight; `[]` for a
  // table being created, which has none by definition. This panel has no synced
  // diagram behind it (the console opens it straight from the table list), so
  // unlike the designer's edit panel it reads them itself — the same read it
  // already makes for the columns, in the same round.
  const [liveIndexes, setLiveIndexes] = useState<any[] | null>(isEdit ? null : [])

  useEffect(() => {
    let alive = true
    getSchema(conn).then((s) => alive && setSchema(s || {}))
    if (isEdit) {
      Promise.all([getColumns(conn, initialTable), getIndexes(conn, initialTable)]).then(([cols, idx]) => {
        if (!alive) return
        setColumns(
          (cols || []).map((c) => ({
            ...newColumn(c.type || 'TEXT'),
            name: c.name,
            type: (c.type || '').toUpperCase() || 'TEXT',
            pk: !!c.pk,
            notNull: !!c.notnull,
            existing: true,
          }))
        )
        setLiveIndexes(idx || [])
      })
    }
    return () => {
      alive = false
    }
  }, [conn, initialTable, isEdit])

  const tableNames = Object.keys(schema)
  const newColumns = columns.filter((c) => !c.existing)

  const setCol = (id, patch) => setColumns((cols) => cols.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const addCol = () => setColumns((cols) => [...cols, newColumn(types[0])])
  const removeCol = (id) => setColumns((cols) => cols.filter((c) => c.id !== id))

  // Column order is the CREATE TABLE's column order, so dragging a card here
  // *is* the schema edit — the statement below the form rewrites as you drop.
  // The indices are into `newColumns` (the cards), never into `columns`: in edit
  // mode the existing columns are read-only rows above them, and ADD COLUMN
  // can't move one anyway.
  const reorderNew = (from, to) => {
    const moved = moveColumn(newColumns, from, to)
    if (moved === newColumns) return
    // Put the reordered new columns back after the existing ones, which keep
    // the order the live schema gave them.
    setColumns([...columns.filter((c) => c.existing), ...moved])
  }
  const reorder = useDragReorder(newColumns.length, reorderNew)
  // One card can't be dragged anywhere, so it shows no grip.
  const canReorder = newColumns.length > 1

  // CREATE builds one statement; ALTER builds one ADD COLUMN per new column.
  const tableStatements = useMemo(() => {
    if (isEdit) {
      return newColumns
        .filter((c) => c.name.trim())
        .map((c) => `ALTER TABLE "${initialTable}" ADD COLUMN ${colDef(c)};`)
    }
    const named = columns.filter((c) => c.name.trim())
    if (!name.trim() || named.length === 0) return []
    return [createTableSql(name.trim(), named)]
  }, [columns, newColumns, name, isEdit, initialTable])

  // ---- Indexes ----
  // The table this form is about, as the index DDL names it — the typed name
  // while creating, the committed one while editing. Only a committed table has
  // indexes to read: a staged CREATE isn't in the database yet, so its indexes
  // come from the statements staged beside it (`draftIndexSql`) instead.
  const tableName = isEdit ? initialTable : name.trim()
  const loadingIndexes = isEdit && liveIndexes === null
  // Parsed once, from the batch this panel opened with — after that the form
  // owns them, so re-parsing would undo whatever has been typed since.
  const [stagedIndexes] = useState(() => draftIndexSql.map(parseCreateIndex).filter(Boolean))
  const indexes = useIndexEditor({ table: tableName, dialect, live: liveIndexes, initial: stagedIndexes })
  // A CREATE INDEX has to name a column the table will actually have.
  const indexableColumns = columns.map((c) => c.name.trim()).filter(Boolean)

  // Indexes are created after the table (or after the columns they cover).
  const statements = useMemo(() => [...tableStatements, ...indexes.statements], [tableStatements, indexes.statements])

  // ---- Form / SQL ----
  // The same DDL, written two ways. The form (Columns + Indexes) is the source
  // of truth: opening SQL regenerates it from the form, so what's there is what
  // the form built. SQL then lets that be edited by hand — a CHECK constraint,
  // an expression index, a column type the picker doesn't offer — and stages
  // the text verbatim.
  //
  // Nothing parses SQL back into the form, so leaving SQL discards hand edits;
  // the switch asks first once the text has been touched.
  //
  // Reopening a staged CREATE (`isDraft`) is the one case that starts on SQL:
  // if the statement isn't what this form would have written, it came from a
  // hand edit or an imported design, and `draftColumns` is a lossy parse of it
  // — showing the form would quietly drop whatever the parser didn't
  // understand the moment it was saved.
  const handWritten = isDraft && !!draftSql && norm(draftSql) !== norm(createTableSql(initialTable, draftColumns))
  // A hand-written draft opens on the whole batch it was staged as — the
  // CREATE TABLE *and* the indexes beside it — because that batch is what
  // submitting from here replaces.
  const draftBatch = [draftSql, ...draftIndexSql].join('\n')
  const [view, setView] = useState(handWritten ? 'sql' : 'fields')
  const [sqlText, setSqlText] = useState(handWritten ? draftBatch : '')
  const [sqlBase, setSqlBase] = useState(handWritten ? draftBatch : '')
  // The view the discard question is waiting on — null while it isn't asked.
  const [confirmDiscard, setConfirmDiscard] = useState(null)
  const sqlEdited = view === 'sql' && norm(sqlText) !== norm(sqlBase)
  const sqlStatements = useMemo(() => splitStatements(sqlText).map((x) => `${x};`), [sqlText])

  const toView = (next) => {
    setConfirmDiscard(null)
    setSqlText('')
    setSqlBase('')
    setView(next)
  }

  const switchView = (next) => {
    if (next === view) return
    if (next === 'sql') {
      const text = statements.join('\n')
      setSqlText(text)
      setSqlBase(text)
      setView('sql')
      return
    }
    // Leaving SQL drops what was typed there, whichever view comes next.
    if (sqlEdited) setConfirmDiscard(next)
    else toView(next)
  }

  // In SQL mode the name comes from the DDL — someone can rename the table by
  // editing the statement, and the staged items have to file under what it
  // actually creates. An existing table can't be renamed from here.
  const staged = view === 'sql' ? sqlStatements : statements
  const stagedName = isEdit ? initialTable : view === 'sql' ? tableNameIn(sqlStatements) || name.trim() : name.trim()

  const valid = staged.length > 0 && (isEdit || !!stagedName)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!valid) return
    // Run the stage action AND close — otherwise the invisible slide-over
    // overlay stays mounted and blocks all clicks.
    close(() => {
      onStage(staged, stagedName, isEdit ? 'edit' : 'new')
      onClose()
    })
  }

  const title = isDraft ? 'Edit New Table' : isEdit ? 'Edit Table' : 'Create Table'

  return (
    <SlideOverPanel
      show={show}
      close={close}
      width={520}
      onSubmit={handleSubmit}
      title={title}
      subheader={<Segmented value={view} onChange={switchView} options={views(indexes.count)} />}
      footer={
        <>
          <Button type="button" variant="subtle" onClick={() => close()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!valid}>
            {isDraft ? 'Update changes' : 'Add to changes'}
          </Button>
        </>
      }
    >
      {view === 'sql' ? (
        <>
          <Label>Statements</Label>
          <div className="overflow-hidden rounded-soft border border-edge">
            <Suspense fallback={<div className="p-8 text-center text-xs text-ink-faint">Loading editor…</div>}>
              <SqlEditor
                value={sqlText}
                onChange={setSqlText}
                dialect={dialect}
                schema={schema}
                minHeight="260px"
                maxHeight="calc(100vh - 340px)"
                placeholder={isEdit ? 'ALTER TABLE …' : 'CREATE TABLE …'}
              />
            </Suspense>
          </div>
          <p className="mt-3 text-[11px] text-ink-faint">
            {staged.length ? (
              <>
                {staged.length} statement{staged.length === 1 ? '' : 's'} will be staged in Changes, exactly as written
                {stagedName ? (
                  <>
                    , under <span className="text-ink-dim">{stagedName}</span>
                  </>
                ) : null}
                .
              </>
            ) : (
              'Write the DDL to stage. Nothing here runs until you release the changes.'
            )}
          </p>
          {!isEdit && !stagedName && staged.length > 0 && (
            <p className="mt-2 text-[11px] text-amber">
              No table name found — name one with <span className="font-mono">CREATE TABLE "…"</span> so the diagram can
              draw it.
            </p>
          )}
          {!isEdit && (
            <p className="mt-2 text-[11px] text-ink-faint">
              The diagram draws a staged table by reading its <span className="text-ink-dim">CREATE TABLE</span>. A batch
              it can't read still stages and still releases — it just won't appear on the canvas until it has run.
            </p>
          )}
          <p className="mt-2 text-[11px] text-ink-faint">
            Switching to <span className="text-ink-dim">Columns</span> rebuilds this from the form — edits made here are
            not read back.
          </p>
        </>
      ) : view === 'indexes' ? (
        <IndexEditor
          editor={indexes}
          table={tableName}
          dialect={dialect}
          columns={indexableColumns}
          loading={loadingIndexes}
        />
      ) : (
        <>
      <FormField label="Table Name">
              <Input
                type="text"
                placeholder="e.g. users"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isEdit}
                autoFocus={!isEdit}
                required
              />
            </FormField>

            <Label>Columns</Label>
            <div className="flex flex-col gap-3" {...reorder.listProps}>
              {/* Existing columns first (they always are — `columns` is loaded
                  from the live schema, then new cards are appended), read-only
                  and not draggable: ADD COLUMN can't move one. */}
              {columns
                .filter((col) => col.existing)
                .map((col) => (
                  <div
                    key={col.id}
                    className="flex items-center gap-2 rounded-soft border border-edge bg-elevated/30 px-3 py-2 text-[11px]"
                  >
                    <span className="flex-1 truncate font-medium text-ink-dim">{col.name}</span>
                    <span className="font-mono text-ink-faint">{col.type}</span>
                    {col.pk && (
                      <span className="rounded bg-green/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-green-bright">PK</span>
                    )}
                    <span className="rounded bg-edge px-1.5 py-0.5 text-[9px] text-ink-faint">existing</span>
                  </div>
                ))}
              {newColumns.map((col, i) => (
                <div key={col.id} className={`relative ${reorder.dragging(i) ? 'opacity-40' : ''}`} {...reorder.itemProps(i, col.id)}>
                  {/* Where the dragged card would land — in the gap above or
                      below this one, which is why it sits outside the card. */}
                  {reorder.indicator(i) && (
                    <div
                      className={`pointer-events-none absolute inset-x-0 z-10 h-[2px] rounded-full bg-green-bright ${
                        reorder.indicator(i) === 'top' ? '-top-1.5' : '-bottom-1.5'
                      }`}
                    />
                  )}
                  <ColumnField
                    col={col}
                    types={types}
                    tableNames={tableNames}
                    schema={schema}
                    allowPk={!isEdit}
                    dragHandle={canReorder ? <DragHandle {...reorder.handleProps(i)} title="Drag to reorder columns" /> : null}
                    onChange={(patch) => setCol(col.id, patch)}
                    onRemove={() => removeCol(col.id)}
                  />
                </div>
              ))}
            </div>

            <TextButton tone="green" className="mt-3 !text-[11px] font-semibold" onClick={addCol}>
              <PlusIcon width={14} height={14} /> Add column
            </TextButton>

            {isEdit && (
              <p className="mt-3 text-[11px] text-ink-faint">
                Editing supports adding new columns (existing columns can’t be altered here). Indexes are edited in the{' '}
                <span className="text-ink-dim">Indexes</span> view.
              </p>
            )}

      {statements.length > 0 && (
        <pre className="mt-5 overflow-x-auto rounded-soft border border-edge bg-bg px-3.5 py-3 font-mono text-[11px] leading-[1.6] text-ink-dim">
          {statements.join('\n')}
        </pre>
      )}
        </>
      )}

      {confirmDiscard && (
        <ConfirmDialog
          title="Discard SQL edits?"
          message="Leaving SQL rebuilds the statements from the form. What you wrote by hand will be lost."
          confirmLabel="Discard"
          danger
          onConfirm={() => toView(confirmDiscard)}
          onCancel={() => setConfirmDiscard(null)}
        />
      )}
    </SlideOverPanel>
  )
}
