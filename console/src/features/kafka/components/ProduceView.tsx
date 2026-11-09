import { useEffect, useMemo, useState } from 'react'
import CodeEditor from '@/shared/ui/CodeEditor'
import { toast } from 'sonner'
import { formatCombo, useKeymap, useShortcut } from '@/features/keymap'
import { CloseIcon, PlusSmall, SaveIcon, SendIcon } from '@/shared/ui/icons'
import { describeTopic, hasSchemaRegistry, listSchemas, listTopics, produceMessage, type SchemaSubject, type TopicSummary } from '../lib/api'
import { quote } from '../lib/format'
import { formatTime } from '@/shared/lib/datetime'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/switch'
import OptionSelect from '@/shared/ui/form/OptionSelect'
import { FormField } from '@/shared/ui/form/FormField'
import { Input } from '@/shared/ui/input'

// One send's outcome: where it landed, or why it didn't.
type Sent = { ok: boolean; partition?: number; offset?: number; key?: string | null; error?: string; at: number }

/**
 * Send one message to a topic: key, headers, value (JSON is checked and can be
 * formatted, but any text goes), or a tombstone. On a production connection
 * the topic name is typed back before anything is sent.
 *
 * "Save as command" stores the equivalent PRODUCE line as a saved query, which
 * is how a message becomes a reusable template — and why templates already
 * travel in the connection export bundle.
 */
export default function ProduceView({
  conn,
  topic: initialTopic,
  draft,
  onSaveCommand,
  onOpenTopic,
}: {
  conn: any
  topic?: string
  draft?: { key?: string | null; value?: string | null; headers?: Record<string, string> | null }
  onSaveCommand: (command: string) => void
  onOpenTopic: (topic: string) => void
}) {
  const { bindings } = useKeymap()
  const [topics, setTopics] = useState<TopicSummary[]>([])
  const [topic, setTopic] = useState(initialTopic || '')
  const [partitions, setPartitions] = useState(0)
  const [partition, setPartition] = useState('')
  const [key, setKey] = useState(draft?.key ?? '')
  const [headers, setHeaders] = useState<{ key: string; value: string }[]>(
    Object.entries(draft?.headers || {}).map(([k, v]) => ({ key: k, value: String(v) }))
  )
  const [value, setValue] = useState(() => {
    const v = draft?.value
    if (v == null) return ''
    try {
      return JSON.stringify(JSON.parse(v), null, 2)
    } catch {
      return v
    }
  })
  const [tombstone, setTombstone] = useState(draft ? draft.value === null : false)
  const [confirm, setConfirm] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<Sent[]>([])
  // With a Schema Registry, either side can be written with a subject's latest schema.
  const registry = hasSchemaRegistry(conn)
  const [subjects, setSubjects] = useState<SchemaSubject[]>([])
  const [keySubject, setKeySubject] = useState('')
  const [valueSubject, setValueSubject] = useState('')
  const [valueMessage, setValueMessage] = useState('')
  const valueType = subjects.find((s) => s.subject === valueSubject)?.type

  const production = conn?.environment === 'production'

  useEffect(() => {
    listTopics(conn).then(setTopics).catch(() => {})
    if (registry) listSchemas(conn).then((r) => setSubjects(r.subjects.filter((s) => s.id != null))).catch(() => {})
  }, [conn, registry])

  // The registry's naming convention: <topic>-key / <topic>-value, picked when present.
  useEffect(() => {
    if (!subjects.length || !topic) return
    const has = (s: string) => subjects.some((x) => x.subject === s)
    setKeySubject(has(`${topic}-key`) ? `${topic}-key` : '')
    setValueSubject(has(`${topic}-value`) ? `${topic}-value` : '')
  }, [subjects, topic])

  useEffect(() => {
    setPartition('')
    if (!topic) return setPartitions(0)
    describeTopic(conn, topic)
      .then((t) => setPartitions(t.partitions))
      .catch(() => setPartitions(0))
  }, [conn, topic])

  const jsonError = useMemo(() => {
    const t = value.trim()
    // Schema-written values are always JSON; otherwise only text that looks like it is checked.
    if (tombstone || !t || (!valueSubject && !/^[[{]/.test(t))) return null
    try {
      JSON.parse(t)
      return null
    } catch (e: any) {
      return e.message
    }
  }, [value, tombstone])

  const headerObject = () => {
    const out: Record<string, string> = {}
    for (const h of headers) if (h.key.trim()) out[h.key.trim()] = h.value
    return Object.keys(out).length ? out : null
  }

  const ready = Boolean(topic) && (tombstone || value.trim() !== '') && !jsonError && (!production || confirm === topic)

  const send = async () => {
    if (!ready || sending) return
    setSending(true)
    try {
      const r = await produceMessage(conn, topic, {
        key: key === '' ? null : key,
        value: tombstone ? null : value,
        headers: headerObject(),
        partition: partition === '' ? null : Number(partition),
        keySchema: keySubject ? { subject: keySubject } : null,
        valueSchema: valueSubject ? { subject: valueSubject, ...(valueMessage.trim() ? { message: valueMessage.trim() } : {}) } : null,
      })
      setSent((s) => [{ ok: true, partition: r.partition, offset: r.offset, key: key || null, at: Date.now() }, ...s].slice(0, 20))
      toast.success(`Sent to ${topic} · partition ${r.partition} @ ${r.offset.toLocaleString()}`)
    } catch (e: any) {
      setSent((s) => [{ ok: false, error: e.message, at: Date.now() }, ...s].slice(0, 20))
      toast.error(`Produce failed: ${e.message}`)
    } finally {
      setSending(false)
    }
  }

  useShortcut('workspace.runQuery', send)

  const command = () => {
    const h = headerObject()
    const compactValue = (() => {
      if (tombstone) return 'null'
      try {
        return JSON.stringify(JSON.parse(value))
      } catch {
        return quote(value)
      }
    })()
    return [
      `PRODUCE ${topic}`,
      partition !== '' ? ` PARTITION ${partition}` : '',
      key ? ` KEY ${quote(key)}` : '',
      h ? ` HEADERS ${JSON.stringify(h)}` : '',
      ` VALUE ${compactValue}`,
    ].join('')
  }

  const format = () => {
    try {
      setValue(JSON.stringify(JSON.parse(value), null, 2))
    } catch {
      toast.error('The value is not valid JSON.')
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[1180px] flex-wrap gap-6 px-[18px] py-5">
        <div className="min-w-0 flex-[999_1_520px]">
          {production && (
            <div className="mb-4 rounded-[9px] border border-destructive/25 bg-destructive/10 px-3.5 py-2.5 text-[12px] text-[#ffb4b4]">
              This is a <strong>production</strong> connection. Services consuming {topic ? <span className="font-mono">{topic}</span> : 'this topic'} will
              process whatever you send.
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-3.5 max-[640px]:grid-cols-1">
            <FormField label="Topic">
              <OptionSelect
                
                value={topic}
                onChange={setTopic}
                searchable
                placeholder="Choose a topic"
                options={topics.map((t) => ({ value: t.name, label: t.name, hint: `${t.partitions} partitions` }))}
              />
            </FormField>
            <FormField label="Partition" hint={partition === '' ? 'Chosen from the key — the same key always lands on the same partition.' : undefined}>
              <OptionSelect
                
                value={partition}
                onChange={setPartition}
                options={[
                  { value: '', label: 'Auto (hash of key)' },
                  ...Array.from({ length: partitions }, (_, i) => ({ value: String(i), label: String(i) })),
                ]}
              />
            </FormField>
          </div>

          {registry && (
            <div className="mb-4 grid grid-cols-2 gap-3.5 max-[640px]:grid-cols-1">
              <FormField label="Key schema" help="Writes the key with this subject's latest schema — type the key as JSON. None sends it as plain text.">
                <OptionSelect
                  
                  value={keySubject}
                  onChange={setKeySubject}
                  searchable
                  options={[{ value: '', label: 'None (plain text)' }, ...subjects.map((s) => ({ value: s.subject, label: s.subject, hint: `${s.type} · v${s.version}` }))]}
                />
              </FormField>
              <FormField label="Value schema" help="Writes the value with this subject's latest schema, in the registry's wire format — type the value as JSON.">
                <OptionSelect
                  
                  value={valueSubject}
                  onChange={setValueSubject}
                  searchable
                  options={[{ value: '', label: 'None (plain text)' }, ...subjects.map((s) => ({ value: s.subject, label: s.subject, hint: `${s.type} · v${s.version}` }))]}
                />
              </FormField>
              {valueType === 'PROTOBUF' && (
                <FormField
                  label={
                    <>
                      Protobuf message <span className="text-faint">(optional)</span>
                    </>
                  }
                  hint="The fully-qualified message to write; the schema's first message when empty."
                >
                  <Input className="font-mono" placeholder="com.acme.Order" value={valueMessage} onChange={(e) => setValueMessage(e.target.value)} />
                </FormField>
              )}
            </div>
          )}

          <FormField label={<>Key <span className="text-faint">(optional)</span></>}>
            <Input className="font-mono" placeholder={keySubject ? '{"id": "ord_123"}' : 'ord_123'} value={key} onChange={(e) => setKey(e.target.value)} />
          </FormField>

          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground">Headers</span>
              <Button variant="link" size="inline" type="button" className="!text-[11px]" onClick={() => setHeaders((h) => [...h, { key: '', value: '' }])}>
                <PlusSmall width={12} height={12} /> Add header
              </Button>
            </div>
            {headers.length === 0 ? (
              <p className="text-[11px] text-faint">None.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {headers.map((h, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      className="!w-[38%] font-mono"
                      placeholder="trace-id"
                      value={h.key}
                      onChange={(e) => setHeaders((hs) => hs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                    />
                    <Input
                      className="font-mono"
                      placeholder="value"
                      value={h.value}
                      onChange={(e) => setHeaders((hs) => hs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                    />
                    <Button variant="ghost" size="icon-sm" aria-label="Remove header" onClick={() => setHeaders((hs) => hs.filter((_, j) => j !== i))}>
                      <CloseIcon width={12} height={12} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold text-muted-foreground">Value</span>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Switch checked={tombstone} onCheckedChange={(checked) => setTombstone(checked === true)} aria-label="Send a tombstone" />
                  Tombstone (null value)
                </label>
                <Button variant="outline" size="sm" onClick={format} disabled={tombstone || !value.trim()}>
                  Format JSON
                </Button>
              </div>
            </div>
            <CodeEditor
              wrapperClassName="min-h-[220px] rounded-lg border border-border bg-muted focus-within:border-primary/25 focus-within:shadow-[0_0_0_3px_rgba(111,207,106,0.22)]"
              className="font-mono text-[12px] leading-relaxed px-3 py-2"
              placeholder={'{\n  "orderId": "ord_123"\n}'}
              value={tombstone ? '' : value}
              disabled={tombstone}
              onChange={setValue}
            />
            {jsonError && (
              <p className="mt-1.5 text-[11px] text-warning">
                {valueSubject ? `A schema-written value is JSON, and this doesn't parse: ${jsonError}` : `Looks like JSON but doesn't parse: ${jsonError}`}
              </p>
            )}
            {tombstone && <p className="mt-1.5 text-[11px] text-faint">On a compacted topic a tombstone deletes the key.</p>}
          </div>

          <div className={`flex flex-wrap items-end gap-3 rounded-lg border p-3.5 ${production ? 'border-destructive/25' : 'border-border'}`}>
            {production && (
              <label className="min-w-[220px] flex-1">
                <span className="mb-1.5 block text-[11px] text-muted-foreground">
                  Type <span className="font-mono text-foreground">{topic || 'the topic'}</span> to confirm
                </span>
                <Input className="font-mono" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={topic} />
              </label>
            )}
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                onClick={() => onSaveCommand(command())}
                disabled={!topic || (!tombstone && !value.trim()) || Boolean(keySubject || valueSubject)}
                title={keySubject || valueSubject ? "The console's PRODUCE writes plain text — it can't carry a schema." : undefined}
              >
                <SaveIcon width={15} height={15} />
                Save as command
              </Button>
              <Button variant="default" onClick={send} disabled={!ready || sending}>
                <SendIcon width={15} height={15} />
                {sending ? 'Sending…' : 'Produce'}
                <kbd className="rounded bg-black/20 px-1.5 py-px text-[10px] font-semibold">{formatCombo(bindings['workspace.runQuery'])}</kbd>
              </Button>
            </div>
          </div>
        </div>

        <aside className="min-w-0 flex-[1_1_280px]">
          <div className="rounded-xl border border-border bg-sidebar p-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-faint">Same as a console command</p>
            <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground">{topic ? command() : 'Choose a topic.'}</pre>
          </div>

          <div className="mt-4 rounded-xl border border-border bg-sidebar p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wide text-faint">Sent from this tab</p>
              {sent.length > 0 && (
                <Button variant="link" size="inline" type="button" className="text-faint hover:text-foreground" onClick={() => setSent([])}>
                  Clear
                </Button>
              )}
            </div>
            {sent.length === 0 ? (
              <p className="mt-2 text-[11px] text-faint">Nothing yet.</p>
            ) : (
              <div className="mt-2 flex flex-col">
                {sent.map((s) => (
                  <div key={s.at} className="flex items-start gap-2.5 border-b border-border/60 py-2 last:border-b-0">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${s.ok ? 'bg-success' : 'bg-destructive'}`} />
                    <div className="min-w-0 flex-1">
                      {s.ok ? (
                        <>
                          <p className="font-mono text-[12px]">
                            p{s.partition} @ {s.offset?.toLocaleString()}
                          </p>
                          <p className="text-[11px] text-faint">
                            {s.key ? `key ${s.key} · ` : ''}
                            {formatTime(s.at)}
                          </p>
                        </>
                      ) : (
                        <p className="break-words text-[11px] text-[#ff9b9b]">{s.error}</p>
                      )}
                    </div>
                    {s.ok && (
                      <Button variant="link" size="inline" type="button" className="!text-[11px]" onClick={() => onOpenTopic(topic)}>
                        View
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
