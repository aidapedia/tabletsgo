import { useCallback, useEffect, useMemo, useState } from 'react'
import DataGrid from '@/shared/ui/table/DataGrid'
import Popover from '@/shared/ui/overlay/Popover'
import { FilterPanel, SortPanel, matchFilter, sortRows, cycleSortRules } from '@/shared/ui/table/GridRules'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import Segmented from '@/shared/ui/form/Segmented'
import { toast } from 'sonner'
import { CloseIcon, FilterIcon, PlusSmall, RefreshIcon, SortIcon, TrashIcon } from '@/shared/ui/icons'
import { ACL_OPERATIONS, ACL_RESOURCE_TYPES, createAcls, deleteAcls, listAcls, type Acl } from '../lib/api'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/switch'
import OptionSelect from '@/shared/ui/form/OptionSelect'
import { FormField } from '@/shared/ui/form/FormField'
import { Input } from '@/shared/ui/input'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

const keyOf = (a: Acl) => [a.principal, a.host, a.operation, a.permission, a.resourceType, a.resourceName, a.patternType].join('|')

const COLUMNS = ['Principal', 'Permission', 'Operation', 'Resource', 'Pattern', 'Host']
const COLUMN_WIDTHS = { Principal: 220, Permission: 100, Operation: 150, Resource: 260, Pattern: 100, Host: 120 }
const gridRow = (a: Acl) => ({
  Principal: a.principal,
  Permission: a.permission,
  Operation: a.operation,
  Resource: `${a.resourceType.toLowerCase()}:${a.resourceName}`,
  Pattern: a.patternType,
  Host: a.host,
  acl: a,
})

/**
 * The cluster's access control lists in the shared DataGrid, laid out like a
 * table in the SQL console: the toolbar's left actions swap to bulk actions
 * while rows are selected. New ones are added one at a time or from a
 * template — consumer, producer, Kafka Streams application — in a slide-over
 * that expands into the bindings that role needs, shown before they're created.
 */
export default function AclsPanel({ conn }: { conn: any }) {
  const [acls, setAcls] = useState<Acl[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<any[]>([])
  const [sort, setSort] = useState<any[]>([]) // [{ col, dir }] — ordered sort rules
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(
    () =>
      listAcls(conn)
        .then((list) => {
          setAcls(list)
          setError(null)
          setSelected((s) => new Set([...s].filter((k) => list.some((a) => keyOf(a) === k))))
        })
        .catch((e) => setError(e.message)),
    [conn]
  )
  useEffect(() => {
    load()
  }, [load])

  // Filter rules, then sort rules — the same client-side pipeline as the
  // query history grid, run over the grid's own row shape.
  const rows = useMemo(
    () => sortRows((acls || []).map(gridRow).filter((r) => filters.every((f) => matchFilter(r, f))), sort),
    [acls, filters, sort]
  )
  const shown = useMemo(() => rows.map((r) => r.acl), [rows])
  const activeFilterCount = filters.filter((f) => f.enabled && f.col && f.value !== '').length
  const activeSortCount = sort.filter((s) => s.col && s.enabled !== false).length

  const toggleRow = (row: any) =>
    setSelected((s) => {
      const k = keyOf(row.acl)
      const next = new Set(s)
      next.has(k) ? next.delete(k) : next.add(k)
      return next
    })
  const toggleAll = () =>
    setSelected((s) => {
      const all = shown.length > 0 && shown.every((a) => s.has(keyOf(a)))
      const next = new Set(s)
      for (const a of shown) all ? next.delete(keyOf(a)) : next.add(keyOf(a))
      return next
    })

  const removeSelected = async () => {
    setConfirming(false)
    const doomed = (acls || []).filter((a) => selected.has(keyOf(a)))
    try {
      const r = await deleteAcls(conn, doomed)
      toast.success(`Deleted ${r.deleted} ACL${r.deleted === 1 ? '' : 's'}.`)
      setSelected(new Set())
      // ACL changes reach DescribeAcls a moment after they're accepted.
      setTimeout(load, 800)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  if (error && !acls) {
    return <div className="mx-[18px] my-4 rounded-[9px] border border-destructive/25 bg-destructive/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">{error}</div>
  }

  const selCount = selected.size

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {/* Keyed on the mode, so swapping to bulk actions (and back) fades in. */}
        {selCount > 0 ? (
          <div key="selection" className="flex animate-in fade-in-0 flex-wrap items-center gap-2">
            <Button variant="default" size="sm" onClick={() => setConfirming(true)} className="!bg-destructive !text-white hover:!bg-destructive/90">
              <TrashIcon width={15} height={15} />
              Delete
            </Button>

            <div className="mx-0.5 h-5 w-px bg-border" />

            <span className="text-[11px] font-semibold text-foreground">{selCount} selected</span>

            <Button variant="ghost" size="sm" className="!px-2" onClick={() => setSelected(new Set())} aria-label="Clear selection">
              <CloseIcon width={16} height={16} />
            </Button>
          </div>
        ) : (
          <div key="default" className="flex animate-in fade-in-0 flex-wrap items-center gap-2">
            <Button variant="default" size="sm" onClick={() => setAdding(true)}>
              <PlusSmall width={15} height={15} />
              Add ACLs
            </Button>
            <Button variant="ghost" size="sm" onClick={load}>
              <RefreshIcon width={15} height={15} />
              Refresh
            </Button>

            <div className="mx-0.5 h-5 w-px bg-border" />

            <Popover
              width={412}
              trigger={({ open, toggle }) => (
                <Button variant="ghost" size="sm" aria-pressed={open || activeFilterCount > 0} onClick={toggle}>
                  <FilterIcon width={15} height={15} />
                  {activeFilterCount > 0 ? `Filtered by ${activeFilterCount} rule${activeFilterCount > 1 ? 's' : ''}` : 'Filter'}
                </Button>
              )}
            >
              {({ close }) => <FilterPanel columns={COLUMNS} initial={filters} onApply={setFilters} onClose={close} />}
            </Popover>

            <Popover
              width={400}
              trigger={({ open, toggle }) => (
                <Button variant="ghost" size="sm" aria-pressed={open || activeSortCount > 0} onClick={toggle}>
                  <SortIcon width={15} height={15} />
                  {activeSortCount > 0 ? `Sorted by ${activeSortCount} rule${activeSortCount > 1 ? 's' : ''}` : 'Sort'}
                </Button>
              )}
            >
              {({ close }) => <SortPanel columns={COLUMNS} initial={sort} onApply={setSort} onClose={close} />}
            </Popover>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="pl-1 text-[11px] text-faint">{acls ? `${shown.length} of ${acls.length} binding${acls.length === 1 ? '' : 's'}` : ''}</span>
        </div>
      </div>

      {acls === null ? (
        <div className="p-5 text-center text-xs text-faint">Reading ACLs…</div>
      ) : !shown.length ? (
        <div className="p-[30px] text-center text-xs text-faint">{activeFilterCount ? 'No ACLs match.' : 'No ACLs on this cluster.'}</div>
      ) : (
        <DataGrid
          columns={COLUMNS}
          rows={rows}
          columnWidths={COLUMN_WIDTHS}
          selectable
          getRowKey={(row: any) => keyOf(row.acl)}
          selectedKeys={selected}
          onToggleRow={toggleRow}
          onToggleAll={toggleAll}
          sort={sort}
          onSort={(col: string, additive: boolean) => setSort((prev) => cycleSortRules(prev, col, additive))}
        />
      )}

      {adding && (
        <AddAclsPanel conn={conn} onClose={() => setAdding(false)} onCreated={() => setTimeout(load, 800)} />
      )}

      {confirming && (
        <ConfirmDialog
          destructive
          title={`Delete ${selCount} ACL${selCount === 1 ? '' : 's'}?`}
          description="Clients relying on these bindings lose that access at once (or regain it, for a DENY)."
          confirmLabel="Delete"
          onConfirm={removeSelected}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}

type Template = 'single' | 'consumer' | 'producer' | 'streams'

const TEMPLATES = [
  { value: 'single', label: 'Single' },
  { value: 'consumer', label: 'Consumer' },
  { value: 'producer', label: 'Producer' },
  { value: 'streams', label: 'Streams app' },
]

const list = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)

// What each role needs, as `kafka-acls --consumer / --producer` and Confluent's
// Kafka Streams security guide spell it out.
function expand(t: Template, f: Record<string, any>): Partial<Acl>[] {
  const base = { principal: f.principal.trim(), host: f.host.trim() || '*', permission: 'ALLOW' as const }
  const pattern = (prefixed: boolean) => (prefixed ? 'PREFIXED' : 'LITERAL') as Acl['patternType']
  const on = (resourceType: string, resourceName: string, patternType: Acl['patternType'], ops: string[]) =>
    ops.map((operation) => ({ ...base, resourceType, resourceName, patternType, operation }))
  if (t === 'single') {
    return [{ ...base, permission: f.permission, resourceType: f.resourceType, resourceName: f.resourceType === 'CLUSTER' ? 'kafka-cluster' : f.resourceName.trim(), patternType: pattern(f.prefixed), operation: f.operation }]
  }
  if (t === 'consumer') {
    return [
      ...list(f.topics).flatMap((topic) => on('TOPIC', topic, pattern(f.prefixed), ['READ', 'DESCRIBE'])),
      ...(f.group.trim() ? on('GROUP', f.group.trim(), pattern(f.groupPrefixed), ['READ']) : []),
    ]
  }
  if (t === 'producer') {
    return [
      ...list(f.topics).flatMap((topic) => on('TOPIC', topic, pattern(f.prefixed), ['WRITE', 'DESCRIBE', 'CREATE'])),
      ...(f.idempotent ? on('CLUSTER', 'kafka-cluster', 'LITERAL', ['IDEMPOTENT_WRITE']) : []),
      ...(f.transactionalId.trim() ? on('TRANSACTIONAL_ID', f.transactionalId.trim(), pattern(f.prefixed), ['WRITE', 'DESCRIBE']) : []),
    ]
  }
  const app = f.appId.trim()
  if (!app) return []
  return [
    ...list(f.inputs).flatMap((topic) => on('TOPIC', topic, 'LITERAL', ['READ', 'DESCRIBE'])),
    ...list(f.outputs).flatMap((topic) => on('TOPIC', topic, 'LITERAL', ['WRITE', 'DESCRIBE'])),
    // Internal repartition/changelog topics are named <application.id>-…
    ...on('TOPIC', app, 'PREFIXED', ['ALL']),
    ...on('GROUP', app, 'LITERAL', ['READ']),
    ...(f.exactlyOnce ? [...on('TRANSACTIONAL_ID', app, 'PREFIXED', ['ALL']), ...on('CLUSTER', 'kafka-cluster', 'LITERAL', ['IDEMPOTENT_WRITE'])] : []),
  ]
}

/** The inspector-style slide-over that composes new bindings. */
function AddAclsPanel({ conn, onClose, onCreated }: { conn: any; onClose: () => void; onCreated: () => void }) {
  const { show, close } = useSlideOver(onClose)
  const [error, setError] = useState<string | null>(null)
  const [template, setTemplate] = useState<Template>('consumer')
  const [f, setF] = useState({
    principal: 'User:',
    host: '*',
    resourceType: 'TOPIC',
    resourceName: '',
    operation: 'READ',
    permission: 'ALLOW',
    prefixed: false,
    topics: '',
    group: '',
    groupPrefixed: false,
    idempotent: true,
    transactionalId: '',
    appId: '',
    inputs: '',
    outputs: '',
    exactlyOnce: false,
  })
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof f) => (v: any) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }))

  const bindings = expand(template, f)
  const principalOk = /^[^:\s]+:\S+/.test(f.principal.trim())
  // The field opens on a bare `User:` — only complain once there's more to it.
  const principalBad = !principalOk && !/^([^:\s]+:)?$/.test(f.principal.trim())
  const ready = principalOk && bindings.length > 0 && bindings.every((b) => b.resourceName)

  const create = async () => {
    if (!ready || saving) return
    setSaving(true)
    setError(null)
    try {
      const r = await createAcls(conn, bindings)
      toast.success(`Created ${r.created} ACL${r.created === 1 ? '' : 's'}.`)
      close(onCreated)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SlideOverPanel
      show={show}
      close={close}
      title="Add ACLs"
      width={520}
      error={error}
      subheader={<Segmented className="w-full [&>button]:flex-1" value={template} onChange={setTemplate} options={TEMPLATES} />}
      footer={
        <>
          <Button variant="ghost" onClick={() => close()}>
            Cancel
          </Button>
          <Button variant="default" onClick={create} disabled={!ready || saving}>
            {saving ? 'Creating…' : `Create ${bindings.length || ''} ACL${bindings.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      {/* FormField drops its own margin inside a grid, so each grid row carries the gap. */}
      <div className="mb-4 grid grid-cols-[2fr_1fr] gap-3.5">
        <FormField label="Principal" hint="<type>:<name> — usually User:<name>, as the broker authenticates it." error={principalBad ? 'Write it as User:alice.' : undefined}>
          <Input autoFocus className="font-mono" value={f.principal} onChange={set('principal')} />
        </FormField>
        <FormField label="Host">
          <Input className="font-mono" value={f.host} onChange={set('host')} placeholder="*" />
        </FormField>
      </div>

      {template === 'single' && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3.5">
            <FormField label="Resource type">
              <OptionSelect value={f.resourceType} onChange={set('resourceType')} options={ACL_RESOURCE_TYPES.map((t) => ({ value: t, label: t }))} />
            </FormField>
            <FormField label="Operation">
              <OptionSelect value={f.operation} onChange={set('operation')} options={ACL_OPERATIONS.map((t) => ({ value: t, label: t }))} />
            </FormField>
          </div>
          <FormField label="Permission">
            <Segmented className="w-full [&>button]:flex-1" value={f.permission} onChange={set('permission')} options={[{ value: 'ALLOW', label: 'Allow' }, { value: 'DENY', label: 'Deny' }]} />
          </FormField>
          {f.resourceType !== 'CLUSTER' && (
            <ResourceName label="Resource name" value={f.resourceName} onChange={set('resourceName')} prefixed={f.prefixed} onPrefixed={set('prefixed')} placeholder="orders or * for all" />
          )}
        </>
      )}

      {template === 'consumer' && (
        <>
          <ResourceName label="Topics" value={f.topics} onChange={set('topics')} prefixed={f.prefixed} onPrefixed={set('prefixed')} placeholder="orders, payments" />
          <ResourceName label="Consumer group" value={f.group} onChange={set('group')} prefixed={f.groupPrefixed} onPrefixed={set('groupPrefixed')} placeholder="billing-service" />
        </>
      )}

      {template === 'producer' && (
        <>
          <ResourceName label="Topics" value={f.topics} onChange={set('topics')} prefixed={f.prefixed} onPrefixed={set('prefixed')} placeholder="orders" />
          <FormField label="Transactional ID (optional)" hint="For a transactional producer.">
            <Input className="font-mono" value={f.transactionalId} onChange={set('transactionalId')} />
          </FormField>
          <label className="mb-4 flex items-center gap-2 text-[12px] text-muted-foreground">
            <Switch checked={f.idempotent} onCheckedChange={(checked) => set('idempotent')(checked === true)} aria-label="Idempotent writes" />
            Idempotent writes (needed before Kafka 3.0)
          </label>
        </>
      )}

      {template === 'streams' && (
        <>
          <FormField label="application.id" hint="Its internal topics and consumer group are named after it.">
            <Input className="font-mono" value={f.appId} onChange={set('appId')} placeholder="order-enricher" />
          </FormField>
          <div className="mb-4 grid grid-cols-2 gap-3.5">
            <FormField label="Input topics">
              <Input className="font-mono" value={f.inputs} onChange={set('inputs')} placeholder="orders" />
            </FormField>
            <FormField label="Output topics">
              <Input className="font-mono" value={f.outputs} onChange={set('outputs')} placeholder="orders-enriched" />
            </FormField>
          </div>
          <label className="mb-4 flex items-center gap-2 text-[12px] text-muted-foreground">
            <Switch checked={f.exactlyOnce} onCheckedChange={(checked) => set('exactlyOnce')(checked === true)} aria-label="Exactly-once" />
            Exactly-once processing (transactional IDs + idempotent writes)
          </label>
        </>
      )}

      <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">Bindings to create</div>
      <div className="rounded-lg border border-border bg-muted px-3 py-2 font-mono text-[11px]">
        {bindings.length === 0 ? (
          <span className="text-faint">Fill in the fields to see the bindings this creates.</span>
        ) : (
          bindings.map((b, i) => (
            <div key={i}>
              <span className={b.permission === 'DENY' ? 'text-destructive' : 'text-primary-bright'}>{b.permission}</span> {b.principal || '…'} {b.operation} {b.resourceType?.toLowerCase()}:
              {b.resourceName || '…'}
              {b.patternType === 'PREFIXED' ? '*' : ''}
            </div>
          ))
        )}
      </div>
    </SlideOverPanel>
  )
}

function ResourceName({
  label,
  value,
  onChange,
  prefixed,
  onPrefixed,
  placeholder,
}: {
  label: string
  value: string
  onChange: (e: any) => void
  prefixed: boolean
  onPrefixed: (on: boolean) => void
  placeholder: string
}) {
  return (
    <FormField label={label}>
      <div className="flex items-center gap-3.5">
        <Input className="min-w-0 flex-1 font-mono" value={value} onChange={onChange} placeholder={placeholder} />
        <label className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
          <Switch checked={prefixed} onCheckedChange={(checked) => onPrefixed(checked === true)} aria-label={`${label} is a prefix`} />
          Prefix
        </label>
      </div>
    </FormField>
  )
}
