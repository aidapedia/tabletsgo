import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import RefreshButton from '@/shared/ui/buttons/RefreshButton'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import Modal from '@/shared/ui/overlay/Modal'
import Select from '@/shared/ui/form/Select'
import Segmented from '@/shared/ui/form/Segmented'
import SearchInput from '@/shared/ui/form/SearchInput'
import Checkbox from '@/shared/ui/form/Checkbox'
import Toggle from '@/shared/ui/form/Toggle'
import { controlClass, Input } from '@/shared/ui/form/Input'
import { FormField } from '@/shared/ui/form/Form'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import { PlusIcon, TrashIcon } from '@/shared/ui/icons'
import { ACL_OPERATIONS, ACL_RESOURCE_TYPES, createAcls, deleteAcls, listAcls, type Acl } from '../lib/api'

const keyOf = (a: Acl) => [a.principal, a.host, a.operation, a.permission, a.resourceType, a.resourceName, a.patternType].join('|')

/**
 * The cluster's access control lists: every binding, filterable, with a
 * multi-select for bulk deletes. New ones are added one at a time or from a
 * template — consumer, producer, Kafka Streams application — that expands into
 * the bindings that role needs, shown before they're created.
 */
export default function AclsPanel({ conn }: { conn: any }) {
  const toast = useToast()
  const [acls, setAcls] = useState<Acl[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
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

  const needle = filter.trim().toLowerCase()
  const shown = useMemo(
    () => (acls || []).filter((a) => !needle || `${a.principal} ${a.resourceType} ${a.resourceName} ${a.operation} ${a.permission}`.toLowerCase().includes(needle)),
    [acls, needle]
  )
  const allShown = shown.length > 0 && shown.every((a) => selected.has(keyOf(a)))

  const toggle = (k: string) =>
    setSelected((s) => {
      const next = new Set(s)
      next.has(k) ? next.delete(k) : next.add(k)
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
    return <div className="mx-[18px] my-4 rounded-[9px] border border-red/25 bg-red/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">{error}</div>
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput className="w-[300px]" placeholder="Filter by principal, resource or operation" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="text-[11px] text-ink-faint">{acls ? `${shown.length} of ${acls.length} binding${acls.length === 1 ? '' : 's'}` : ''}</span>
        <div className="ml-auto flex items-center gap-2">
          {selected.size > 0 && (
            <Button variant="danger" size="sm" icon={TrashIcon} onClick={() => setConfirming(true)}>
              Delete {selected.size}
            </Button>
          )}
          <Tooltip label="Refresh" placement="bottom">
            <RefreshButton size="sm" iconSize={13} aria-label="Refresh ACLs" onRefresh={load} />
          </Tooltip>
          <Button variant="primary" size="sm" icon={PlusIcon} onClick={() => setAdding(true)}>
            Add ACLs
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-card border border-edge bg-panel">
        <table className="w-full min-w-[820px] border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-[11px] text-ink-faint">
              <th className="h-8 w-9 border-b border-edge px-3">
                <Checkbox
                  checked={allShown}
                  onChange={(on: boolean) => setSelected((s) => {
                    const next = new Set(s)
                    for (const a of shown) on ? next.add(keyOf(a)) : next.delete(keyOf(a))
                    return next
                  })}
                  ariaLabel="Select all shown"
                />
              </th>
              {['Principal', 'Permission', 'Operation', 'Resource', 'Host'].map((h) => (
                <th key={h} className="h-8 border-b border-edge px-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {acls === null && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-xs text-ink-faint">
                  Reading ACLs…
                </td>
              </tr>
            )}
            {acls && !shown.length && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-xs text-ink-faint">
                  {needle ? 'No ACLs match.' : 'No ACLs on this cluster.'}
                </td>
              </tr>
            )}
            {shown.map((a) => {
              const k = keyOf(a)
              return (
                <tr key={k} className={selected.has(k) ? 'bg-green/5' : ''}>
                  <td className="h-[30px] border-b border-edge/60 px-3">
                    <Checkbox checked={selected.has(k)} onChange={() => toggle(k)} ariaLabel="Select ACL" />
                  </td>
                  <td className="border-b border-edge/60 px-3 font-mono">{a.principal}</td>
                  <td className={`border-b border-edge/60 px-3 font-semibold ${a.permission === 'DENY' ? 'text-red' : 'text-green-bright'}`}>{a.permission}</td>
                  <td className="border-b border-edge/60 px-3 font-mono">{a.operation}</td>
                  <td className="border-b border-edge/60 px-3 font-mono">
                    <span className="text-ink-faint">{a.resourceType.toLowerCase()}:</span>
                    {a.resourceName}
                    {a.patternType === 'PREFIXED' && (
                      <span className="ml-2 rounded-[5px] bg-elevated px-1.5 py-px font-sans text-[9px] font-bold uppercase text-ink-dim">prefix</span>
                    )}
                  </td>
                  <td className="border-b border-edge/60 px-3 font-mono text-ink-dim">{a.host}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {adding && (
        <AddAclsDialog
          conn={conn}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false)
            setTimeout(load, 800)
          }}
        />
      )}

      {confirming && (
        <ConfirmDialog
          danger
          title={`Delete ${selected.size} ACL${selected.size === 1 ? '' : 's'}?`}
          message="Clients relying on these bindings lose that access at once (or regain it, for a DENY)."
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

function AddAclsDialog({ conn, onClose, onCreated }: { conn: any; onClose: () => void; onCreated: () => void }) {
  const toast = useToast()
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
  const ready = principalOk && bindings.length > 0 && bindings.every((b) => b.resourceName)

  const create = async () => {
    if (!ready || saving) return
    setSaving(true)
    try {
      const r = await createAcls(conn, bindings)
      toast.success(`Created ${r.created} ACL${r.created === 1 ? '' : 's'}.`)
      onCreated()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Add ACLs" onClose={onClose} width={760}>
      <Segmented className="mb-4 w-full [&>button]:flex-1" value={template} onChange={setTemplate} options={TEMPLATES} />
      <div className="mb-1 grid grid-cols-[2fr_1fr] gap-3.5">
        <FormField label="Principal" hint="<type>:<name> — usually User:<name>, as the broker authenticates it." error={f.principal.trim() && !principalOk ? 'Write it as User:alice.' : undefined}>
          <Input autoFocus className="font-mono" value={f.principal} onChange={set('principal')} />
        </FormField>
        <FormField label="Host">
          <Input className="font-mono" value={f.host} onChange={set('host')} placeholder="*" />
        </FormField>
      </div>

      {template === 'single' && (
        <>
          <div className="grid grid-cols-3 gap-3.5">
            <FormField label="Resource type">
              <Select className={controlClass} value={f.resourceType} onChange={set('resourceType')} options={ACL_RESOURCE_TYPES.map((t) => ({ value: t, label: t }))} />
            </FormField>
            <FormField label="Operation">
              <Select className={controlClass} value={f.operation} onChange={set('operation')} options={ACL_OPERATIONS.map((t) => ({ value: t, label: t }))} />
            </FormField>
            <FormField label="Permission">
              <Segmented className="w-full [&>button]:flex-1" value={f.permission} onChange={set('permission')} options={[{ value: 'ALLOW', label: 'Allow' }, { value: 'DENY', label: 'Deny' }]} />
            </FormField>
          </div>
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
          <div className="grid grid-cols-2 gap-3.5">
            <FormField label="Transactional ID (optional)" hint="For a transactional producer.">
              <Input className="font-mono" value={f.transactionalId} onChange={set('transactionalId')} />
            </FormField>
            <label className="mt-6 flex items-center gap-2 text-[12px] text-ink-dim">
              <Toggle checked={f.idempotent} onChange={set('idempotent')} ariaLabel="Idempotent writes" />
              Idempotent writes (needed before Kafka 3.0)
            </label>
          </div>
        </>
      )}

      {template === 'streams' && (
        <>
          <FormField label="application.id" hint="Its internal topics and consumer group are named after it.">
            <Input className="font-mono" value={f.appId} onChange={set('appId')} placeholder="order-enricher" />
          </FormField>
          <div className="grid grid-cols-2 gap-3.5">
            <FormField label="Input topics">
              <Input className="font-mono" value={f.inputs} onChange={set('inputs')} placeholder="orders" />
            </FormField>
            <FormField label="Output topics">
              <Input className="font-mono" value={f.outputs} onChange={set('outputs')} placeholder="orders-enriched" />
            </FormField>
          </div>
          <label className="mb-4 flex items-center gap-2 text-[12px] text-ink-dim">
            <Toggle checked={f.exactlyOnce} onChange={set('exactlyOnce')} ariaLabel="Exactly-once" />
            Exactly-once processing (transactional IDs + idempotent writes)
          </label>
        </>
      )}

      <div className="mb-4 max-h-[180px] overflow-y-auto rounded-soft border border-edge bg-elevated px-3 py-2 font-mono text-[11px]">
        {bindings.length === 0 ? (
          <span className="text-ink-faint">Fill in the fields to see the bindings this creates.</span>
        ) : (
          bindings.map((b, i) => (
            <div key={i}>
              <span className={b.permission === 'DENY' ? 'text-red' : 'text-green-bright'}>{b.permission}</span> {b.principal || '…'} {b.operation} {b.resourceType?.toLowerCase()}:
              {b.resourceName || '…'}
              {b.patternType === 'PREFIXED' ? '*' : ''}
            </div>
          ))
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={create} disabled={!ready || saving}>
          {saving ? 'Creating…' : `Create ${bindings.length || ''} ACL${bindings.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </Modal>
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
    <div className="grid grid-cols-[1fr_auto] items-end gap-3.5">
      <FormField label={label}>
        <Input className="font-mono" value={value} onChange={onChange} placeholder={placeholder} />
      </FormField>
      <label className="mb-[22px] flex items-center gap-2 text-[12px] text-ink-dim">
        <Toggle checked={prefixed} onChange={onPrefixed} ariaLabel={`${label} is a prefix`} />
        Prefix
      </label>
    </div>
  )
}
