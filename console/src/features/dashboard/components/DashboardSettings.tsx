import { useState } from 'react'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import SqlEditor from '@/shared/ui/SqlEditor'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import { EditIcon, PlusIcon, TrashIcon } from '@/shared/ui/icons'
import type { DashboardVariable, VariableSource } from '../types'
import { parseStaticValues } from '../lib/variables'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Switch } from '@/shared/ui/switch'
import OptionSelect from '@/shared/ui/form/OptionSelect'
import { FormField } from '@/shared/ui/form/FormField'
import { Input } from '@/shared/ui/input'

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
  const { show, close } = useSlideOver(onClose)
  const [title, setTitle] = useState(name)
  const [vars, setVars] = useState<DashboardVariable[]>(variables)
  // The variable being created/edited in the inline form (null = list mode).
  const [editing, setEditing] = useState<DashboardVariable | null>(startWithNewVariable ? emptyVariable() : null)

  const save = () => close(() => onSave({ name: title.trim(), variables: vars }))

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
    <SlideOverPanel
      show={show}
      close={close}
      title="Dashboard settings"
      width={560}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => close()}>
            Cancel
          </Button>
          <Button variant="default" size="sm" disabled={!title.trim() || !!editing} onClick={save}>
            Save settings
          </Button>
        </>
      }
    >
      <div className="space-y-5">
          <FormField label="Dashboard title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </FormField>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground">Dynamic variables</span>
              {!editing && (
                <Button variant="outline" size="sm" onClick={() => setEditing(emptyVariable())}>
                  <PlusIcon width={15} height={15} />
                  Add variable
                </Button>
              )}
            </div>

            {editing ? (
              <div className="space-y-3 rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap gap-3">
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
                    <OptionSelect
                      
                      value={editing.source}
                      onChange={(source: VariableSource) => setEditing({ ...editing, source })}
                      options={SOURCE_OPTIONS}
                    />
                  </FormField>
                </div>

                {editing.source === 'query' ? (
                  <FormField label="Options query" hint="First column = value, optional second column = display label (e.g. SELECT id, name FROM events).">
                    <div className="overflow-hidden rounded-lg border border-border">
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
                    placeholder={editing.multi ? 'One value pre-selected (else all are selected)' : 'Falls back to the first option'}
                  />
                </FormField>

                <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-foreground">Allow multiple selections</div>
                    <div className="text-[11px] text-faint">
                      {'{{'}
                      {editing.name || 'name'}
                      {'}}'} expands to a SQL list — use it as <code className="text-muted-foreground">IN ({'{{'}
                      {editing.name || 'name'}
                      {'}}'})</code>.
                    </div>
                  </div>
                  <Switch
                    checked={!!editing.multi}
                    onCheckedChange={(checked) => setEditing({ ...editing, multi: checked === true })}
                    aria-label="Allow multiple selections"
                  />
                </label>

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                  <Button variant="default" size="sm" disabled={!editingValid} onClick={commitVariable}>
                    {vars.some((v) => v.id === editing.id) ? 'Update variable' : 'Add variable'}
                  </Button>
                </div>
              </div>
            ) : vars.length === 0 ? (
              <EmptyState bordered>No variables yet — add one to filter widgets dynamically.</EmptyState>
            ) : (
              <div className="flex flex-col gap-1.5">
                {vars.map((v) => (
                  <div key={v.id} className="group flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2">
                    <code className="text-[11px] font-semibold text-foreground">{`{{${v.name}}}`}</code>
                    <Badge>{v.source}</Badge>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-faint">
                      {v.source === 'query' ? v.query : v.values}
                    </span>
                    <Button variant="ghost" size="icon-xs" aria-label="Edit variable" onClick={() => setEditing({ ...v })}>
                      <EditIcon width={14} height={14} />
                    </Button>
                    <Button variant="ghost" size="icon-xs"
                      aria-label="Delete variable"
                      onClick={() => setVars((prev) => prev.filter((x) => x.id !== v.id))}
                    >
                      <TrashIcon width={14} height={14} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
      </div>
    </SlideOverPanel>
  )
}
