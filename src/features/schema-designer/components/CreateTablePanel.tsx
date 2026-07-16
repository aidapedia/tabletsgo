import { useEffect, useMemo, useState } from 'react'
import { getColumns, getSchema } from '@/shared/api/database'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { PlusIcon } from '@/shared/ui/icons'
import { Input } from '@/shared/ui/form/Input'
import { FormField, Label } from '@/shared/ui/form/Form'
import { ColumnField, colDef, newColumn, useColumnTypes } from '@/features/schema-designer/components/columnFields'

/**
 * Three modes, all sharing one form:
 * - create (default): stages a CREATE TABLE for a brand-new table.
 * - edit (`initialTable`): a committed table — columns load from the live
 *   schema and only ADD COLUMN is stageable.
 * - draft (`draftColumns`): a table whose CREATE TABLE is still staged and
 *   uncommitted, so everything (name included) is still freely editable and
 *   submitting restages the whole CREATE.
 */
export default function CreateTablePanel({ conn, initialTable, draftColumns, onClose, onStage }: any) {
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

  useEffect(() => {
    let alive = true
    getSchema(conn).then((s) => alive && setSchema(s || {}))
    if (isEdit) {
      getColumns(conn, initialTable).then((cols) => {
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

  // CREATE builds one statement; ALTER builds one ADD COLUMN per new column.
  const statements = useMemo(() => {
    if (isEdit) {
      return newColumns
        .filter((c) => c.name.trim())
        .map((c) => `ALTER TABLE "${initialTable}" ADD COLUMN ${colDef(c)};`)
    }
    const named = columns.filter((c) => c.name.trim())
    if (!name.trim() || named.length === 0) return []
    return [`CREATE TABLE "${name.trim()}" (\n  ${named.map(colDef).join(',\n  ')}\n);`]
  }, [columns, newColumns, name, isEdit, initialTable])

  const valid = isEdit ? statements.length > 0 : name.trim() && statements.length > 0

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!valid) return
    // Run the stage action AND close — otherwise the invisible slide-over
    // overlay stays mounted and blocks all clicks.
    close(() => {
      onStage(statements, name.trim(), isEdit ? 'edit' : 'new')
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
      <FormField label="Table Name" className="mb-[18px]">
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
            <div className="flex flex-col gap-3">
              {columns.map((col) =>
                col.existing ? (
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
                ) : (
                  <ColumnField
                    key={col.id}
                    col={col}
                    types={types}
                    tableNames={tableNames}
                    schema={schema}
                    allowPk={!isEdit}
                    onChange={(patch) => setCol(col.id, patch)}
                    onRemove={() => removeCol(col.id)}
                  />
                )
              )}
            </div>

            <TextButton tone="green" className="mt-3 !text-[11px] font-semibold" onClick={addCol}>
              <PlusIcon width={14} height={14} /> Add column
            </TextButton>

            {isEdit && (
              <p className="mt-3 text-[11px] text-ink-faint">
                Editing supports adding new columns (existing columns can’t be altered here).
              </p>
            )}

      {statements.length > 0 && (
        <pre className="mt-5 overflow-x-auto rounded-soft border border-edge bg-bg px-3.5 py-3 font-mono text-[11px] leading-[1.6] text-ink-dim">
          {statements.join('\n')}
        </pre>
      )}
    </SlideOverPanel>
  )
}
