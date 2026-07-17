import { useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import { Input, controlClass } from '@/shared/ui/form/Input'
import { FormField } from '@/shared/ui/form/Form'
import Select from '@/shared/ui/form/Select'
import SqlEditor from '@/shared/ui/SqlEditor'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import Badge from '@/shared/ui/Badge'
import { EditIcon, PlusIcon, TrashIcon } from '@/shared/ui/icons'
import type { DashboardVariable, VariableSource } from '../types'
import { parseStaticValues } from '../lib/variables'

const SOURCE_OPTIONS = [
  { value: 'query', label: 'Query' },
  { value: 'static', label: 'Static list' },
]

const emptyVariable = (): DashboardVariable => ({
  id: `v${Date.now()}`,
  name: '',
  source: 'static',
  values: '',
})

// Dashboard settings: rename the dashboard and manage its dynamic variables.
// Edits are applied to a draft and committed together on Save.
export default function DashboardSettings({
  name,
  variables,
  dialect,
  schema,
  startWithNewVariable = false,
  onSave,
  onClose,
}: {
  name: string
  variables: DashboardVariable[]
  dialect?: string
  schema?: Record<string, string[]>
  /** Open straight into the "add variable" form — used when reached via the dashboard's own "Add variable" prompt. */
  startWithNewVariable?: boolean
  onSave: (fields: { name: string; variables: DashboardVariable[] }) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(name)
  const [vars, setVars] = useState<DashboardVariable[]>(variables)
  // The variable being created/edited in the inline form (null = list mode).
  const [editing, setEditing] = useState<DashboardVariable | null>(startWithNewVariable ? emptyVariable() : null)

  const commitVariable = () => {
    if (!editing) return
    const clean = { ...editing, name: editing.name.trim().replace(/\s+/g, '_') }
    setVars((prev) => (prev.some((v) => v.id === clean.id) ? prev.map((v) => (v.id === clean.id ? clean : v)) : [...prev, clean]))
    setEditing(null)
  }

  const editingNameTaken = editing ? vars.some((v) => v.id !== editing.id && v.name === editing.name.trim().replace(/\s+/g, '_')) : false
  const editingValid =
    !!editing &&
    !!editing.name.trim() &&
    !editingNameTaken &&
    (editing.source === 'query' ? !!editing.query?.trim() : parseStaticValues(editing.values).length > 0)

  return (
    <div
      className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-[640px] animate-pop flex-col rounded-[16px] border border-edge-strong bg-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-edge px-5 py-4 text-sm font-bold text-ink">Dashboard settings</div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <FormField label="Dashboard title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </FormField>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-ink-dim">Dynamic variables</span>
              {!editing && (
                <Button size="sm" icon={PlusIcon} onClick={() => setEditing(emptyVariable())}>
                  Add variable
                </Button>
              )}
            </div>

            {editing ? (
              <div className="space-y-3 rounded-soft border border-edge bg-card p-4">
                <div className="flex gap-3">
                  <FormField label="Name" className="flex-1" hint="Used in widget SQL as {{name}}." error={editingNameTaken ? 'A variable with this name already exists.' : undefined}>
                    <Input
                      autoFocus
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      placeholder="event_id"
                    />
                  </FormField>
                  <FormField label="Label (optional)" className="flex-1">
                    <Input
                      value={editing.label ?? ''}
                      onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                      placeholder="Event"
                    />
                  </FormField>
                  <FormField label="Source" className="w-[140px]">
                    <Select
                      className={controlClass}
                      value={editing.source}
                      onChange={(source: VariableSource) => setEditing({ ...editing, source })}
                      options={SOURCE_OPTIONS}
                    />
                  </FormField>
                </div>

                {editing.source === 'query' ? (
                  <FormField label="Options query" hint="First column = value, optional second column = display label (e.g. SELECT id, name FROM events).">
                    <div className="overflow-hidden rounded-soft border border-edge">
                      <SqlEditor
                        value={editing.query ?? ''}
                        onChange={(query) => setEditing({ ...editing, query })}
                        dialect={dialect}
                        schema={schema}
                        minHeight="64px"
                        maxHeight="160px"
                        placeholder="SELECT id, name FROM events"
                      />
                    </div>
                  </FormField>
                ) : (
                  <FormField label="Values" hint={'Comma-separated, quotes optional: 1, 2, "local".'}>
                    <Input
                      value={editing.values ?? ''}
                      onChange={(e) => setEditing({ ...editing, values: e.target.value })}
                      placeholder='1, 2, "local"'
                    />
                  </FormField>
                )}

                <FormField label="Default value (optional)">
                  <Input
                    value={editing.defaultValue ?? ''}
                    onChange={(e) => setEditing({ ...editing, defaultValue: e.target.value })}
                    placeholder="Falls back to the first option"
                  />
                </FormField>

                <div className="flex justify-end gap-2">
                  <Button variant="subtle" size="sm" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" disabled={!editingValid} onClick={commitVariable}>
                    {vars.some((v) => v.id === editing.id) ? 'Update variable' : 'Add variable'}
                  </Button>
                </div>
              </div>
            ) : vars.length === 0 ? (
              <EmptyState bordered>No variables yet — add one to filter widgets dynamically.</EmptyState>
            ) : (
              <div className="flex flex-col gap-1.5">
                {vars.map((v) => (
                  <div key={v.id} className="group flex items-center gap-2.5 rounded-soft border border-edge bg-card px-3 py-2">
                    <code className="text-[11px] font-semibold text-ink">{`{{${v.name}}}`}</code>
                    <Badge>{v.source}</Badge>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-ink-faint">
                      {v.source === 'query' ? v.query : v.values}
                    </span>
                    <IconButton size="sm" aria-label="Edit variable" onClick={() => setEditing({ ...v })}>
                      <EditIcon width={14} height={14} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      aria-label="Delete variable"
                      onClick={() => setVars((prev) => prev.filter((x) => x.id !== v.id))}
                    >
                      <TrashIcon width={14} height={14} />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-edge px-5 py-4">
          <Button variant="subtle" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!title.trim() || !!editing}
            onClick={() => onSave({ name: title.trim(), variables: vars })}
          >
            Save settings
          </Button>
        </div>
      </div>
    </div>
  )
}
