import Button from '@/shared/ui/Button'
import Select from '@/shared/ui/Select'
import IconButton from '@/shared/ui/IconButton'
import SqlEditor from '@/shared/ui/SqlEditor'
import { Input, Textarea, controlClass } from '@/shared/ui/Input'
import { FormField, Label } from '@/shared/ui/Form'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { ChevronRight, PlusIcon, TrashIcon } from '@/shared/ui/icons'
import { NODE_SPECS } from '@/features/workflow/lib/nodeSpec'

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }))

// Slide-over that edits the selected node's `data`. Every change flows straight
// up via onChange so the canvas card and the debounced autosave stay in sync.
export default function NodeConfigPanel({ node, onChange, onChangeType, allowType, schema, dialect, onDelete, onClose }: any) {
  const { show, close } = useSlideOver(onClose)
  const spec = NODE_SPECS[node.type]
  const d = node.data || {}
  const set = (patch: Record<string, any>) => onChange(node.id, patch)

  const isAllowedType = allowType || (() => true)
  const typeOptions = Object.values(NODE_SPECS)
    .filter((s) => isAllowedType(s.type))
    .map((s) => ({ value: s.type, label: `${s.label} · ${s.category}` }))

  const setCase = (i: number, patch: Record<string, any>) =>
    set({ cases: (d.cases || []).map((c: any, idx: number) => (idx === i ? { ...c, ...patch } : c)) })
  const addCase = () => set({ cases: [...(d.cases || []), { expr: '', label: `Case ${(d.cases?.length || 0) + 1}` }] })
  const removeCase = (i: number) => set({ cases: (d.cases || []).filter((_: any, idx: number) => idx !== i) })

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end bg-black/50 transition-opacity duration-200 ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseDown={() => close()}
    >
      <div
        className={`flex h-full w-full max-w-[440px] flex-col border-l border-edge-strong bg-panel shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.8)] transition-transform duration-200 ease-out ${
          show ? 'translate-x-0' : 'translate-x-full'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-edge px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className={`flex h-7 w-7 items-center justify-center rounded bg-elevated ${spec.accent}`}>
              <spec.icon width={15} height={15} />
            </span>
            <div>
              <h3 className="text-sm font-bold">{spec.label}</h3>
              <p className="text-[10px] uppercase tracking-wide text-ink-faint">{spec.category}</p>
            </div>
          </div>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-soft text-ink-dim hover:bg-elevated hover:text-ink"
            onClick={() => close()}
            aria-label="Close"
          >
            <ChevronRight />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-4 text-[11px] leading-relaxed text-ink-faint">{spec.description}</p>

          {onChangeType && (
            <FormField label="Node type" className="mb-4" hint="Switching type resets this node's configuration.">
              <Select
                className={controlClass}
                value={node.type}
                options={typeOptions}
                onChange={(v) => v !== node.type && onChangeType(node.id, v)}
              />
            </FormField>
          )}

          <FormField label="Node label" className="mb-4">
            <Input value={d.title || ''} placeholder={spec.label} onChange={(e) => set({ title: e.target.value })} />
          </FormField>

          {node.type === 'schedule' && (
            <FormField label="Cron expression" hint="Stored for future scheduling. The workflow runs when you click Run.">
              <Input value={d.cron || ''} placeholder="0 0 * * *" onChange={(e) => set({ cron: e.target.value })} />
            </FormField>
          )}

          {node.type === 'query' && (
            <FormField label="SQL" hint="Output: { columns, rows } passed to the next node. Autocompletes tables & columns.">
              <div className="overflow-hidden rounded-soft border border-edge-strong bg-bg">
                <SqlEditor
                  value={d.sql || ''}
                  onChange={(v: string) => set({ sql: v })}
                  dialect={dialect}
                  schema={schema}
                  placeholder="SELECT * FROM users"
                  minHeight="160px"
                  maxHeight="320px"
                />
              </div>
            </FormField>
          )}

          {node.type === 'http' && (
            <>
              <FormField label="Method" className="mb-4">
                <Select
                  className={controlClass}
                  value={d.method || 'GET'}
                  options={HTTP_METHODS}
                  onChange={(v) => set({ method: v })}
                />
              </FormField>
              <FormField label="URL" className="mb-4">
                <Input value={d.url || ''} placeholder="https://api.example.com/data" onChange={(e) => set({ url: e.target.value })} />
              </FormField>
              <FormField label="Headers (JSON)" className="mb-4" hint='e.g. {"Authorization": "Bearer …"}'>
                <Textarea
                  className="min-h-[70px] font-mono"
                  value={d.headers || ''}
                  placeholder="{}"
                  onChange={(e) => set({ headers: e.target.value })}
                />
              </FormField>
              <FormField label="Body" hint="Sent for non-GET requests.">
                <Textarea
                  className="min-h-[90px] font-mono"
                  value={d.body || ''}
                  onChange={(e) => set({ body: e.target.value })}
                />
              </FormField>
            </>
          )}

          {node.type === 'js' && (
            <FormField label="JavaScript" hint="The body receives `input` and must `return` the node's output.">
              <Textarea
                className="min-h-[220px] font-mono"
                value={d.code || ''}
                placeholder="return input"
                onChange={(e) => set({ code: e.target.value })}
              />
            </FormField>
          )}

          {node.type === 'switch' && (
            <>
              <Label>Cases</Label>
              <p className="-mt-1 mb-3 text-[11px] text-ink-faint">
                Routed top-to-bottom to the first case whose expression is truthy (evaluated with `input`); otherwise the
                Default branch.
              </p>
              <div className="flex flex-col gap-3">
                {(d.cases || []).map((c: any, i: number) => (
                  <div key={i} className="rounded-soft border border-edge bg-elevated/40 p-2.5">
                    <div className="mb-2 flex items-center gap-2">
                      <Input
                        className="!py-1"
                        value={c.label || ''}
                        placeholder={`Case ${i + 1}`}
                        onChange={(e) => setCase(i, { label: e.target.value })}
                      />
                      <IconButton onClick={() => removeCase(i)} aria-label="Remove case" className="hover:!text-red">
                        <TrashIcon width={14} height={14} />
                      </IconButton>
                    </div>
                    <Input
                      className="font-mono"
                      value={c.expr || ''}
                      placeholder="input.status === 'active'"
                      onChange={(e) => setCase(i, { expr: e.target.value })}
                    />
                  </div>
                ))}
              </div>
              <Button variant="ghost" size="sm" icon={PlusIcon} className="mt-3" onClick={addCase}>
                Add case
              </Button>
            </>
          )}

          {node.type === 'loop' && (
            <FormField
              label="Items expression"
              hint="Optional JS expression selecting the array to iterate (e.g. `input.rows`). Leave blank to loop `input` directly."
            >
              <Input
                className="font-mono"
                value={d.itemsExpr || ''}
                placeholder="input.rows"
                onChange={(e) => set({ itemsExpr: e.target.value })}
              />
            </FormField>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-edge px-5 py-3.5">
          <Button variant="danger" size="sm" icon={TrashIcon} onClick={() => close(() => onDelete(node.id))}>
            Delete node
          </Button>
          <Button variant="ghost" size="sm" onClick={() => close()}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
