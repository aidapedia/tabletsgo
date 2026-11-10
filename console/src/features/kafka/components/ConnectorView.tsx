import { useCallback, useEffect, useState } from 'react'
import CodeEditor from '@/shared/ui/CodeEditor'
import { highlight } from '@/shared/ui/highlight'
import { toast } from 'sonner'
import {
  connectorAction,
  deleteConnector,
  describeConnector,
  listConnectorPlugins,
  saveConnector,
  validateConnector,
  type ConnectorAction,
  type ConnectorDetail,
} from '../lib/api'
import { Button } from '@/shared/ui/button'
import OptionSelect from '@/shared/ui/form/OptionSelect'
import { FormField } from '@/shared/ui/form/FormField'
import { Input } from '@/shared/ui/input'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

// Connect's states → the dot beside a connector or task.
const STATE_TONE: Record<string, string> = {
  RUNNING: 'bg-primary',
  PAUSED: 'bg-warning',
  STOPPED: 'bg-faint',
  UNASSIGNED: 'bg-faint',
  RESTARTING: 'bg-warning',
  FAILED: 'bg-destructive',
}
export const StateDot = ({ state }: { state: string }) => (
  <span className={`h-2 w-2 shrink-0 rounded-full ${STATE_TONE[state] || 'bg-faint'}`} title={state} />
)

// A state change shows in the status endpoint a moment after it's accepted.
const SETTLE_MS = 1200

/** What a new-connector tab starts from — empty, or a duplicate's config. */
export type ConnectorDraft = { name: string; config: Record<string, string> }

/**
 * One Kafka Connect connector in a tab: its tasks (with the stack trace of a
 * failed one), config and topics, and every lifecycle action. With no name, a
 * new connector being written — its config validated against its plugin
 * before it saves, so a mistyped setting is named instead of failing later.
 */
export default function ConnectorView({
  conn,
  name,
  draft,
  onOpenConnector,
  onChanged,
  onDeleted,
}: {
  conn: any
  name: string | null
  draft?: ConnectorDraft | null
  /** A connector's own tab — after creating one — or a new tab seeded with a draft (Duplicate). */
  onOpenConnector: (name: string | null, draft?: ConnectorDraft) => void
  /** Connectors changed — the sidebar re-reads them. */
  onChanged: () => void
  onDeleted: (name: string) => void
}) {
  const [detail, setDetail] = useState<ConnectorDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(!name)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [openTrace, setOpenTrace] = useState<number | 'connector' | null>(null)

  const load = useCallback(() => {
    if (!name) return
    return describeConnector(conn, name)
      .then((d) => {
        setDetail(d)
        setError(null)
      })
      .catch((e) => setError(e.message))
  }, [conn, name])
  useEffect(() => {
    load()
  }, [load])

  const act = async (action: ConnectorAction, opts: { task?: number; onlyFailed?: boolean } = {}, done = '') => {
    if (!detail) return
    setBusy(true)
    try {
      await connectorAction(conn, detail.name, action, opts)
      toast.success(done || `${detail.name}: ${action} sent.`)
      await new Promise((r) => setTimeout(r, SETTLE_MS))
      await load()
      onChanged()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setDeleting(false)
    if (!detail) return
    try {
      await deleteConnector(conn, detail.name)
      toast.success(`Deleted connector ${detail.name}.`)
      onChanged()
      onDeleted(detail.name)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  if (editing) {
    return (
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-[18px] py-4">
        <ConnectorEditor
          conn={conn}
          isNew={!name}
          initialName={name || draft?.name || ''}
          initialConfig={name ? detail?.config || {} : draft?.config || {}}
          onCancel={name ? () => setEditing(false) : undefined}
          onSaved={(saved) => {
            onChanged()
            if (name) {
              setEditing(false)
              load()
            } else onOpenConnector(saved)
          }}
        />
      </div>
    )
  }

  if (error && !detail) return <div className="mx-[18px] my-4 rounded-[9px] border border-destructive/25 bg-destructive/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">{error}</div>
  if (!detail) return <div className="p-[30px] text-center text-xs text-faint">Reading {name}…</div>

  const state = detail.state

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-[18px] py-4">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-mono text-[14px] font-semibold">
            <StateDot state={state} /> {detail.name}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-faint" title={detail.className || ''}>
            {detail.type} · {detail.className} · {state.toLowerCase()} on {detail.workerId || '—'}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {state === 'PAUSED' || state === 'STOPPED' ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => act('resume', {}, `Resumed ${detail.name}.`)}>
              Resume
            </Button>
          ) : (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => act('pause', {}, `Paused ${detail.name}.`)}>
              Pause
            </Button>
          )}
          {state !== 'STOPPED' && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => act('stop', {}, `Stopped ${detail.name}.`)}>
              Stop
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => act('restart', {}, `Restarted ${detail.name} and its tasks.`)}>
            Restart
          </Button>
          {detail.failedTasks > 0 && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => act('restart', { onlyFailed: true }, 'Restarted the failed tasks.')}>
              Restart failed
            </Button>
          )}
          {state === 'STOPPED' && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => act('resetOffsets', {}, `Reset ${detail.name}'s offsets.`)}>
              Reset offsets
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit config
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const { name: _name, ...config } = detail.config
              onOpenConnector(null, { name: `${detail.name}-copy`, config })
            }}
          >
            Duplicate
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        </div>
      </div>

      {detail.trace && (
        <div className="mb-4 rounded-[9px] border border-destructive/25 bg-destructive/10 px-3.5 py-2.5 text-[11px] text-[#ff9b9b]">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate font-semibold">The connector failed: {detail.trace.split('\n')[0]}</span>
            <Button variant="link" size="inline" type="button" className="text-faint hover:text-foreground shrink-0 !text-[11px]" onClick={() => setOpenTrace((o) => (o === 'connector' ? null : 'connector'))}>
              {openTrace === 'connector' ? 'Hide' : 'Full trace'}
            </Button>
          </div>
          {openTrace === 'connector' && <pre className="mt-2 max-h-[260px] overflow-auto font-mono">{detail.trace}</pre>}
        </div>
      )}

      <div className="mb-2 text-xs font-semibold">Tasks</div>
      <div className="mb-5 overflow-hidden rounded-xl border border-border bg-sidebar">
        {detail.tasks.length === 0 && <div className="p-4 text-center text-xs text-faint">No tasks running — a paused or stopped connector has none assigned.</div>}
        {detail.tasks.map((t) => (
          <div key={t.id} className="border-b border-border/60 px-3.5 py-2 last:border-b-0">
            <div className="flex items-center gap-3 text-[12px]">
              <StateDot state={t.state} />
              <span className="font-mono font-semibold">task {t.id}</span>
              <span className={t.state === 'FAILED' ? 'font-semibold text-destructive' : 'text-muted-foreground'}>{t.state.toLowerCase()}</span>
              <span className="truncate font-mono text-[11px] text-faint">{t.workerId}</span>
              <div className="ml-auto flex gap-3">
                {t.trace && (
                  <Button variant="link" size="inline" type="button" className="text-faint hover:text-foreground !text-[11px]" onClick={() => setOpenTrace((o) => (o === t.id ? null : t.id))}>
                    {openTrace === t.id ? 'Hide error' : 'Show error'}
                  </Button>
                )}
                <Button variant="link" size="inline" type="button" className="!text-[11px]" disabled={busy} onClick={() => act('restartTask', { task: t.id }, `Restarted task ${t.id}.`)}>
                  Restart
                </Button>
              </div>
            </div>
            {t.trace && openTrace === t.id && <pre className="mt-2 max-h-[260px] overflow-auto rounded-lg bg-muted p-3 font-mono text-[11px] text-[#ff9b9b]">{t.trace}</pre>}
          </div>
        ))}
      </div>

      {detail.topics.length > 0 && (
        <>
          <div className="mb-2 text-xs font-semibold">Topics</div>
          <div className="mb-5 flex flex-wrap gap-1.5">
            {detail.topics.map((t) => (
              <span key={t} className="rounded-[5px] border border-border bg-muted px-2 py-0.5 font-mono text-[11px]">
                {t}
              </span>
            ))}
          </div>
        </>
      )}

      <div className="mb-2 text-xs font-semibold">Configuration</div>
      <pre className="overflow-x-auto rounded-xl border border-border bg-sidebar p-4 font-mono text-[12px] leading-relaxed">{highlight(JSON.stringify(detail.config, null, 2))}</pre>

      {deleting && (
        <ConfirmDialog destructive
          title={`Delete connector "${detail.name}"?`}
          description="Its tasks stop and its config is removed from the Connect cluster. Topics it wrote and offsets it committed stay."
          typeToConfirm={detail.name}
          confirmLabel="Delete connector"
          onConfirm={remove}
          onCancel={() => setDeleting(false)}
        />
      )}
    </div>
  )
}

// A new connector, or another config for an existing one.
function ConnectorEditor({
  conn,
  isNew,
  initialName,
  initialConfig,
  onCancel,
  onSaved,
}: {
  conn: any
  isNew: boolean
  initialName: string
  initialConfig: Record<string, string>
  /** Back to the connector; a new connector's tab has nothing to go back to. */
  onCancel?: () => void
  onSaved: (name: string) => void
}) {
  const [name, setName] = useState(initialName)
  const [text, setText] = useState(Object.keys(initialConfig).length ? JSON.stringify(initialConfig, null, 2) : '')
  const [plugins, setPlugins] = useState<{ className: string; type: string; version: string }[]>([])
  const [errors, setErrors] = useState<{ name: string; errors: string[] }[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listConnectorPlugins(conn).then(setPlugins).catch(() => {})
  }, [conn])

  const parsed = (() => {
    try {
      const v = JSON.parse(text || '{}')
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : null
    } catch {
      return null
    }
  })()

  const pickPlugin = (className: string) => {
    const plugin = plugins.find((p) => p.className === className)
    const base: Record<string, string> = { 'connector.class': className, 'tasks.max': '1' }
    if (plugin?.type === 'sink') base.topics = ''
    setText(JSON.stringify({ ...base, ...(parsed || {}), 'connector.class': className }, null, 2))
    setErrors(null)
  }

  const validate = async () => {
    if (!parsed) return
    setBusy(true)
    try {
      const r = await validateConnector(conn, name.trim() || 'validation', parsed)
      setErrors(r.errors)
      if (!r.errorCount) toast.success('The worker accepts this config.')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!parsed || !name.trim()) return
    setBusy(true)
    try {
      const r = await validateConnector(conn, name.trim(), parsed)
      if (r.errorCount) {
        setErrors(r.errors)
        toast.error(`${r.errorCount} setting${r.errorCount === 1 ? '' : 's'} need fixing first.`)
        return
      }
      await saveConnector(conn, name.trim(), parsed)
      toast.success(`${isNew ? 'Created' : 'Updated'} connector ${name.trim()}.`)
      onSaved(name.trim())
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="mb-4 text-[14px] font-semibold">{isNew ? 'New connector' : `Edit ${initialName}`}</div>
      <div className="mb-1 grid grid-cols-2 gap-3.5 max-[720px]:grid-cols-1">
        <FormField label="Name">
          <Input autoFocus={isNew} disabled={!isNew} className="font-mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="orders-to-s3" />
        </FormField>
        <FormField label="Plugin" hint="Choosing one sets connector.class and the minimum settings.">
          <OptionSelect
            
            value={parsed?.['connector.class'] || ''}
            onChange={pickPlugin}
            searchable
            placeholder="Choose a connector class"
            options={plugins.map((p) => ({ value: p.className, label: p.className.split('.').pop() || p.className, hint: `${p.type} · ${p.version}` }))}
          />
        </FormField>
      </div>
      <FormField label="Config (JSON)" error={text.trim() && !parsed ? 'Not a JSON object.' : undefined}>
        <CodeEditor
          wrapperClassName="min-h-[320px] rounded-lg border border-border bg-muted focus-within:border-primary/25 focus-within:shadow-[0_0_0_3px_rgba(111,207,106,0.22)]"
          className="font-mono text-[12px] leading-relaxed px-3 py-2"
          value={text}
          onChange={setText}
          placeholder='{ "connector.class": "…", "tasks.max": "1" }'
        />
      </FormField>
      {errors && errors.length > 0 && (
        <div className="mb-3 rounded-[9px] border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[11px] text-warning">
          {errors.map((e) => (
            <div key={e.name}>
              <span className="font-mono font-semibold">{e.name}</span>: {e.errors.join(' ')}
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button variant="ghost" onClick={validate} disabled={busy || !parsed?.['connector.class']}>
          Validate
        </Button>
        <Button variant="default" onClick={save} disabled={busy || !parsed?.['connector.class'] || !name.trim()}>
          {busy ? 'Working…' : isNew ? 'Create' : 'Save'}
        </Button>
      </div>
    </>
  )
}
