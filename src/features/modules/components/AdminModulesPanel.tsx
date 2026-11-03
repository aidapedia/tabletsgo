import { useEffect, useState, type FormEvent } from 'react'
import Badge from '@/shared/ui/Badge'
import Button from '@/shared/ui/buttons/Button'
import Toggle from '@/shared/ui/form/Toggle'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { useToast } from '@/shared/ui/feedback/Toast'
import Modal from '@/shared/ui/overlay/Modal'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { useModules } from '../stores/ModulesContext'
import ModuleIcon from './ModuleIcon'
import ModuleSettingsFields, { draftOf, patchOf } from './ModuleSettingsFields'
import { blockingConnections, getAdminModules, updateModule } from '../api'
import type { AdminModule, BlockingConnection, ModulePatch } from '../api'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const SECTIONS = [
  { kind: 'engine', title: 'Databases' },
  { kind: 'feature', title: 'Features' },
] as const

/**
 * Admin → Modules: which databases and features this instance offers, and their
 * instance-wide settings.
 *
 * The server decides what may change. Turning on is immediate; turning off a
 * feature asks first; turning off an engine is simply attempted — when
 * connections still use it the server refuses with the list, and that list is
 * what the blocked dialog shows. Nothing here guesses at the rule.
 */
export default function AdminModulesPanel() {
  const toast = useToast()
  const { refresh } = useModules()
  const [modules, setModules] = useState<AdminModule[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmOff, setConfirmOff] = useState<AdminModule | null>(null)
  const [blocked, setBlocked] = useState<{ module: AdminModule; connections: BlockingConnection[] } | null>(null)
  const [configuring, setConfiguring] = useState<AdminModule | null>(null)

  useEffect(() => {
    getAdminModules()
      .then(setModules)
      .catch((err) => toast.error(err.message))
  }, [])

  // Save one module's change; true when it took.
  const apply = async (m: AdminModule, patch: ModulePatch, done: string) => {
    setBusy(m.id)
    try {
      setModules(await updateModule(m.id, patch))
      refresh()
      toast.success(done)
      return true
    } catch (err) {
      const connections = blockingConnections(err)
      if (connections) setBlocked({ module: m, connections })
      else toast.error(err.message)
      return false
    } finally {
      setBusy(null)
    }
  }

  const toggle = (m: AdminModule) => {
    if (!m.enabled) return apply(m, { enabled: true }, `${m.label} turned on — workspaces can use it right away.`)
    if (m.kind === 'feature') return setConfirmOff(m)
    apply(m, { enabled: false }, `${m.label} turned off — it’s gone from the connection picker in every workspace.`)
  }

  if (!modules) return <LoadingState className="" />

  return (
    <div className="flex flex-col gap-7">
      {SECTIONS.map((s) => {
        const list = modules.filter((m) => m.kind === s.kind)
        return (
          <section key={s.kind}>
            <div className="mb-2.5 flex items-baseline gap-2">
              <h2 className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{s.title}</h2>
              <span className="text-[11px] text-ink-faint">
                {list.filter((m) => m.enabled).length} of {list.length} enabled
              </span>
            </div>
            <div className="divide-y divide-edge overflow-hidden rounded-card border border-edge bg-card">
              {list.map((m) => (
                <ModuleRow
                  key={m.id}
                  module={m}
                  busy={busy === m.id}
                  onToggle={() => toggle(m)}
                  onConfigure={() => setConfiguring(m)}
                />
              ))}
            </div>
          </section>
        )
      })}

      <p className="max-w-[680px] text-[11px] leading-relaxed text-ink-faint">
        A database can only be turned off once no connection uses it — turning a module off never deletes anyone’s work.
      </p>

      {confirmOff && (
        <ConfirmDialog
          title={`Turn off ${confirmOff.label}?`}
          message={`Its schedules stop running and its tabs are hidden in every workspace. Nothing is deleted — schedules, run history and stored files stay, and everything resumes when you turn ${confirmOff.label} back on.`}
          confirmLabel={`Turn off ${confirmOff.label}`}
          danger
          onCancel={() => setConfirmOff(null)}
          onConfirm={() => {
            const m = confirmOff
            setConfirmOff(null)
            apply(m, { enabled: false }, `${m.label} turned off.`)
          }}
        />
      )}

      {blocked && <BlockedDialog {...blocked} onClose={() => setBlocked(null)} />}

      {configuring && (
        <ModuleSettingsPanel
          module={configuring}
          onClose={() => setConfiguring(null)}
          onSave={(settings) => apply(configuring, { settings }, `${configuring.label} settings saved.`)}
        />
      )}
    </div>
  )
}

function usageOf(m: AdminModule) {
  if (m.usage) {
    const { connections, workspaces } = m.usage
    return {
      line: connections ? `${plural(connections, 'connection')} · ${plural(workspaces, 'workspace')}` : 'Not in use',
      hint: m.enabled && connections ? 'Remove its connections to turn it off' : '',
    }
  }
  return { line: m.enabled ? 'On for every workspace' : 'Paused', hint: '' }
}

function ModuleRow({
  module: m,
  busy,
  onToggle,
  onConfigure,
}: {
  module: AdminModule
  busy: boolean
  onToggle: () => void
  onConfigure: () => void
}) {
  const usage = usageOf(m)
  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5 ${m.enabled ? '' : 'bg-bg/40'}`}>
      <ModuleIcon module={m} className={`h-10 w-10 ${m.enabled ? '' : 'opacity-50'}`} />
      <div className="min-w-[200px] flex-1">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          {m.label}
          <Badge tone={m.enabled ? 'green' : 'faint'}>{m.enabled ? 'Enabled' : 'Off'}</Badge>
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">{m.description}</p>
      </div>
      <div className="w-[210px] text-[11px] max-[720px]:w-auto">
        <div className="text-ink">{usage.line}</div>
        {usage.hint && <div className="mt-0.5 text-ink-faint">{usage.hint}</div>}
      </div>
      {/* Fixed width, so the usage column lines up whether or not a row has Configure. */}
      <div className="ml-auto flex w-[150px] items-center justify-end gap-3">
        {m.enabled && m.settings.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onConfigure}>
            Configure
          </Button>
        )}
        <Toggle checked={m.enabled} disabled={busy} onChange={onToggle} ariaLabel={`${m.enabled ? 'Turn off' : 'Turn on'} ${m.label}`} />
      </div>
    </div>
  )
}

// What still uses an engine the admin tried to turn off. An instance admin
// can't open workspace connections, so this names where each lives and who owns
// it — the owner is who removes it.
function BlockedDialog({
  module: m,
  connections,
  onClose,
}: {
  module: AdminModule
  connections: BlockingConnection[]
  onClose: () => void
}) {
  const toast = useToast()
  const workspaces = new Set(connections.map((c) => c.workspaceId)).size

  const copy = async () => {
    const lines = connections.map((c) => `${c.name} — ${c.workspaceName || 'no workspace'} — owner: ${c.ownerName || 'unknown'}`)
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      toast.success('Owner list copied.')
    } catch {
      toast.error('Couldn’t copy — select the list and copy it by hand.')
    }
  }

  return (
    <Modal title={`${m.label} can’t be turned off yet`} onClose={onClose} width={520}>
      <p className="text-[12px] leading-relaxed text-ink-dim">
        {plural(connections.length, 'connection')} in {plural(workspaces, 'workspace')} still{' '}
        {connections.length === 1 ? 'uses' : 'use'} {m.label}. Remove {connections.length === 1 ? 'it' : 'them'} first —
        turning a database off never deletes anyone’s work.
      </p>
      <ul className="mt-3 divide-y divide-edge overflow-hidden rounded-soft border border-edge">
        {connections.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-[12px]">
            <span className="font-mono">{c.name}</span>
            <span className="text-ink-dim">{c.workspaceName || 'No workspace'}</span>
            <span className="ml-auto text-ink-faint">Owner: {c.ownerName || 'unknown'}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
        An instance admin can’t open workspace connections, so ask each owner to delete theirs, then try again.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="subtle" size="sm" onClick={copy}>
          Copy owner list
        </Button>
        <Button variant="primary" size="sm" onClick={onClose}>
          Got it
        </Button>
      </div>
    </Modal>
  )
}

function ModuleSettingsPanel({
  module: m,
  onClose,
  onSave,
}: {
  module: AdminModule
  onClose: () => void
  onSave: (settings: ModulePatch['settings']) => Promise<boolean>
}) {
  const { show, close } = useSlideOver(onClose)
  const [draft, setDraft] = useState(() => draftOf(m.settings))
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const ok = await onSave(patchOf(m.settings, draft))
    setSaving(false)
    if (ok) close()
  }

  return (
    <SlideOverPanel
      show={show}
      close={close}
      title={`${m.label} settings`}
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="subtle" size="sm" onClick={() => close()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </>
      }
    >
      <p className="mb-5 text-[12px] leading-relaxed text-ink-dim">These apply to every {m.label} connection on this instance.</p>
      <ModuleSettingsFields moduleId={m.id} settings={m.settings} draft={draft} onChange={(k, v) => setDraft((d) => ({ ...d, [k]: v }))} />
    </SlideOverPanel>
  )
}
