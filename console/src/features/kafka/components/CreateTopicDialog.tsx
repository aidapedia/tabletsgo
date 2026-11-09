import { useEffect, useMemo, useState } from 'react'
import Segmented from '@/shared/ui/form/Segmented'
import NumberStepper from '@/shared/ui/form/NumberStepper'
import { toast } from 'sonner'
import { CloseIcon, PlusSmall } from '@/shared/ui/icons'
import { createTopic, describeTopic, getOverview, listTopics, type TopicSummary } from '../lib/api'
import { Button } from '@/shared/ui/button'
import OptionSelect from '@/shared/ui/form/OptionSelect'
import { FormField } from '@/shared/ui/form/FormField'
import { Input } from '@/shared/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/dialog'

const RETENTION = [
  { value: '', label: 'Cluster default' },
  { value: '3600000', label: '1 hour' },
  { value: '86400000', label: '1 day' },
  { value: '604800000', label: '7 days' },
  { value: '2592000000', label: '30 days' },
  { value: '-1', label: 'Forever' },
]

// Configs the dedicated fields own; the free-form rows hold everything else.
const OWNED = new Set(['cleanup.policy', 'retention.ms', 'min.insync.replicas'])

/**
 * New topic: name, partitions, replication and the configs people actually set,
 * plus free-form ones. "Copy settings from" seeds it from an existing topic. The
 * equivalent console command is shown alongside, so the dialog teaches the
 * console rather than hiding it.
 */
export default function CreateTopicDialog({
  conn,
  topics: givenTopics,
  brokerCount: givenBrokers,
  cloneOf,
  onClose,
  onCreated,
  onOpenInConsole,
}: {
  conn: any
  /** The cluster's topics and broker count — read here when the caller hasn't them. */
  topics?: TopicSummary[]
  brokerCount?: number
  /** Clone: name it "<topic>.copy" and copy that topic's settings in. */
  cloneOf?: string
  onClose: () => void
  onCreated: (name: string) => void
  onOpenInConsole: (command: string) => void
}) {
  const [loadedTopics, setLoadedTopics] = useState<TopicSummary[]>([])
  const [loadedBrokers, setLoadedBrokers] = useState(1)
  const topics = givenTopics || loadedTopics
  const brokerCount = givenBrokers || loadedBrokers
  const [name, setName] = useState(cloneOf ? `${cloneOf}.copy` : '')
  const [partitions, setPartitions] = useState<number | null>(3)
  const [replication, setReplication] = useState(Math.min(3, Math.max(brokerCount, 1)))
  const [cleanup, setCleanup] = useState('delete')
  const [retention, setRetention] = useState('')
  const [minIsr, setMinIsr] = useState('')
  const [extra, setExtra] = useState<{ key: string; value: string }[]>([])
  const [copyFrom, setCopyFrom] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validName = /^[a-zA-Z0-9._-]{1,249}$/.test(name) && name !== '.' && name !== '..'
  const taken = topics.some((t) => t.name === name)

  const configs = useMemo(() => {
    const out: Record<string, string> = {}
    if (cleanup !== 'delete') out['cleanup.policy'] = cleanup === 'both' ? 'compact,delete' : cleanup
    if (retention) out['retention.ms'] = retention
    if (minIsr) out['min.insync.replicas'] = minIsr
    for (const e of extra) if (e.key.trim()) out[e.key.trim()] = e.value
    return out
  }, [cleanup, retention, minIsr, extra])

  const command = [
    `CREATE TOPIC ${name || '<name>'}`,
    partitions ? ` PARTITIONS ${partitions}` : '',
    ` REPLICATION ${replication}`,
    Object.keys(configs).length ? ` WITH ${Object.entries(configs).map(([k, v]) => `${k}=${/[\s,]/.test(v) ? `'${v}'` : v}`).join(', ')}` : '',
  ].join('')

  const copySettings = async (topic: string, brokers = brokerCount) => {
    setCopyFrom(topic)
    if (!topic) return
    try {
      const t = await describeTopic(conn, topic)
      setPartitions(t.partitions)
      setReplication(Math.min(t.replication || 1, Math.max(brokers, 1)))
      const overrides = t.configs.filter((c) => !c.isDefault && !c.readOnly && !c.sensitive && c.value != null)
      const get = (k: string) => overrides.find((c) => c.name === k)?.value || ''
      const policy = get('cleanup.policy')
      setCleanup(policy.includes('compact') && policy.includes('delete') ? 'both' : policy || 'delete')
      setRetention(get('retention.ms'))
      setMinIsr(get('min.insync.replicas'))
      setExtra(overrides.filter((c) => !OWNED.has(c.name)).map((c) => ({ key: c.name, value: c.value as string })))
    } catch (e: any) {
      toast.error(`Could not read ${topic}: ${e.message}`)
    }
  }

  useEffect(() => {
    if (!givenTopics) listTopics(conn).then(setLoadedTopics).catch(() => {})
    // A clone's replication is capped by the broker count, so that comes first.
    const brokers = givenBrokers ? Promise.resolve(givenBrokers) : getOverview(conn).then((o) => o.brokers.length).catch(() => 1)
    brokers.then((n) => {
      setLoadedBrokers(n)
      if (cloneOf) copySettings(cloneOf, n)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async () => {
    if (!validName || taken || saving) return
    setSaving(true)
    setError(null)
    try {
      await createTopic(conn, { name, partitions: partitions || undefined, replication, configs })
      toast.success(`Created topic ${name}.`)
      onCreated(name)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const replicationOptions = Array.from({ length: Math.min(Math.max(brokerCount, 1), 5) }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100vh-6rem)] flex-col sm:max-w-[860px]">
        <DialogHeader>
          <DialogTitle>{cloneOf ? `Clone topic "${cloneOf}"` : 'Create topic'}</DialogTitle>
        </DialogHeader>
        {/* -mx/px so a focus ring inside the body isn't clipped by the scroller. */}
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <div className="flex flex-wrap gap-6">
            <div className="min-w-0 flex-[3_1_360px]">
              <FormField
                label="Name"
                hint={taken ? undefined : 'Letters, digits, ".", "_" and "-", up to 249 characters. Partitions can grow later; they never shrink.'}
                error={taken ? 'A topic with this name already exists.' : undefined}
              >
                <Input autoFocus className="font-mono" placeholder="orders.disputed" value={name} onChange={(e) => setName(e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && submit()} />
              </FormField>

              <div className="mb-4 grid grid-cols-2 gap-3.5 max-[560px]:grid-cols-1">
                <FormField label="Copy settings from">
                  <OptionSelect
              
                    value={copyFrom}
                    onChange={copySettings}
                    searchable
                    placeholder="Start from scratch"
                    options={[{ value: '', label: 'Start from scratch' }, ...topics.map((t) => ({ value: t.name, label: t.name }))]}
                  />
                </FormField>
                <FormField label="Partitions">
                  <NumberStepper value={partitions} onChange={setPartitions} min={1} max={10000} ariaLabel="Partitions" />
                </FormField>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-3.5 max-[560px]:grid-cols-1">
                <FormField label="Replication factor" hint={`This cluster has ${brokerCount} broker${brokerCount === 1 ? '' : 's'}.`}>
                  <Segmented value={String(replication)} onChange={(v) => setReplication(Number(v))} options={replicationOptions} />
                </FormField>
                <FormField label="min.insync.replicas">
                  <OptionSelect
              
                    value={minIsr}
                    onChange={setMinIsr}
                    options={[{ value: '', label: 'Cluster default' }, ...Array.from({ length: replication }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))]}
                  />
                </FormField>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-3.5 max-[560px]:grid-cols-1">
                <FormField label="Cleanup policy">
                  <Segmented
                    value={cleanup}
                    onChange={setCleanup}
                    options={[
                      { value: 'delete', label: 'delete' },
                      { value: 'compact', label: 'compact' },
                      { value: 'both', label: 'both' },
                    ]}
                  />
                </FormField>
                <FormField label="Retention">
                  <OptionSelect value={retention} onChange={setRetention} options={RETENTION} />
                </FormField>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-muted-foreground">Other configs</span>
                <Button variant="link" size="inline" type="button" className="!text-[11px]" onClick={() => setExtra((e) => [...e, { key: '', value: '' }])}>
                  <PlusSmall width={12} height={12} /> Add config
                </Button>
              </div>
              {extra.length === 0 ? (
                <p className="mb-2 text-[11px] text-faint">None — e.g. compression.type or max.message.bytes.</p>
              ) : (
                <div className="mb-2 flex flex-col gap-1.5">
                  {extra.map((e, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Input
                        className="!w-[45%] font-mono"
                        placeholder="config.name"
                        value={e.key}
                        onChange={(ev) => setExtra((xs) => xs.map((x, j) => (j === i ? { ...x, key: ev.target.value } : x)))}
                      />
                      <Input
                        className="font-mono"
                        placeholder="value"
                        value={e.value}
                        onChange={(ev) => setExtra((xs) => xs.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)))}
                      />
                      <Button variant="ghost" size="icon-sm" aria-label="Remove config" onClick={() => setExtra((xs) => xs.filter((_, j) => j !== i))}>
                        <CloseIcon width={12} height={12} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="min-w-0 flex-[2_1_240px]">
              <div className="rounded-lg border border-border bg-background p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-faint">Same as a console command</p>
                <pre className="mt-2.5 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground">{command}</pre>
                <Button variant="outline" size="sm" className="mt-3" disabled={!validName} onClick={() => onOpenInConsole(command)}>
                  Open in console
                </Button>
              </div>
            </div>
          </div>

          {error && <div className="mt-3 rounded-[9px] border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-[11px] text-[#ff9b9b]">{error}</div>}

          <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="default" onClick={submit} disabled={!validName || taken || saving}>
              {saving ? 'Creating…' : 'Create topic'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
