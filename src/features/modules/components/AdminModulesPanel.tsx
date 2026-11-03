import { useEffect, useMemo, useState, type FormEvent } from 'react'
import Badge from '@/shared/ui/Badge'
import Button from '@/shared/ui/buttons/Button'
import Toggle from '@/shared/ui/form/Toggle'
import Checkbox from '@/shared/ui/form/Checkbox'
import PersonRow from '@/shared/ui/PersonRow'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import useDataTable from '@/shared/ui/table/useDataTable'
import { ChevronDown } from '@/shared/ui/icons'
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
import type { AdminModule, BlockingConnection, ModulePatch, OwnerNotice } from '../api'

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
 * what the in-use dialog shows. From there the admin can turn it off anyway:
 * the connections are locked, not deleted, and their owners are notified.
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
      setModules((await updateModule(m.id, patch)).modules)
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

  // Turn an engine off while connections use it: they're locked, not deleted.
  const forceOff = async (m: AdminModule, notify: boolean) => {
    setBusy(m.id)
    try {
      const { modules: next, notified } = await updateModule(m.id, { enabled: false }, { force: true, notify })
      setModules(next)
      setBlocked(null)
      refresh()
      toast.success(`${m.label} turned off — its connections are locked, not deleted.`)
      if (notified) reportNotice(toast, notified)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(null)
    }
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
        Turning a database off that connections still use locks them — nobody can open or change them until it’s back
        on, but nothing is deleted.
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

      {blocked && (
        <InUseDialog
          {...blocked}
          busy={busy === blocked.module.id}
          onForce={(notify) => forceOff(blocked.module, notify)}
          onClose={() => setBlocked(null)}
        />
      )}

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
    if (!connections) return { line: 'Not in use', hint: '', warn: false }
    const where = `${plural(connections, 'connection')} · ${plural(workspaces, 'workspace')}`
    return m.enabled
      ? { line: where, hint: 'Turning it off locks them', warn: false }
      : { line: `${plural(connections, 'connection')} locked`, hint: 'Deleted by their owners, or back when it’s on', warn: true }
  }
  return { line: m.enabled ? 'On for every workspace' : 'Paused', hint: '', warn: false }
}

// After notifying owners: say how many were reached, and name who wasn't.
function reportNotice(toast: ReturnType<typeof useToast>, notice: OwnerNotice | { error: string }) {
  if ('error' in notice) return toast.error(`Couldn’t notify the owners: ${notice.error}`)
  if (notice.owners) toast.success(`Notified ${plural(notice.owners, 'owner')} by email.`)
  if (notice.failed.length) toast.error(`Couldn’t notify ${notice.failed.map((f) => f.email).join(', ')}.`)
}

// The dialog's connections by owner — the same rule the server sends by (one
// recipient per address, trimmed and lower-cased), so what the admin sees is
// who gets an email. Connections without an owner address go last, unnotified.
type OwnerGroup = { key: string; email: string | null; name: string | null; connections: BlockingConnection[]; workspaces: string[] }

function byOwner(connections: BlockingConnection[]): OwnerGroup[] {
  const groups = new Map<string, OwnerGroup>()
  for (const c of connections) {
    const email = (c.ownerEmail || '').trim().toLowerCase()
    const key = email || 'no-owner'
    if (!groups.has(key)) groups.set(key, { key, email: email || null, name: c.ownerName, connections: [], workspaces: [] })
    const g = groups.get(key)!
    g.connections.push(c)
    const ws = c.workspaceName || 'No workspace'
    if (!g.workspaces.includes(ws)) g.workspaces.push(ws)
  }
  return [...groups.values()].sort((a, b) => Number(!a.email) - Number(!b.email))
}

// The in-use owners as a paged table: one row per owner (who gets one email),
// expanding to the connections they own.
function OwnersTable({ groups }: { groups: OwnerGroup[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const columns = useMemo<Column<OwnerGroup>[]>(
    () => [
      {
        key: 'owner',
        header: 'Owner',
        sortable: true,
        sortValue: (g) => g.name || g.email || '',
        render: (g) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              aria-expanded={open.has(g.key)}
              aria-label={`${open.has(g.key) ? 'Collapse' : 'Expand'} ${g.name || g.email || 'connections without an owner'}`}
              onClick={(e) => {
                e.stopPropagation()
                toggle(g.key)
              }}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-ink-dim transition-colors hover:bg-card-hover hover:text-ink"
            >
              <ChevronDown width={14} height={14} className={`transition-transform ${open.has(g.key) ? '' : '-rotate-90'}`} />
            </button>
            {g.email ? (
              <PersonRow name={g.name || undefined} email={g.email} stacked />
            ) : (
              <span className="text-[12px] text-ink-dim">No owner to notify</span>
            )}
          </div>
        ),
      },
      {
        key: 'connections',
        header: 'Connections',
        sortable: true,
        sortValue: (g) => g.connections.length,
        align: 'right',
        width: 110,
        render: (g) => <span className="text-[12px] text-ink-dim">{g.connections.length}</span>,
      },
      {
        key: 'workspaces',
        header: 'Workspaces',
        className: 'max-[560px]:hidden',
        render: (g) => <span className="block truncate text-[12px] text-ink-dim">{g.workspaces.join(', ')}</span>,
      },
    ],
    [open]
  )
  const table = useDataTable({ rows: groups, columns, pageSize: 5 })

  return (
    <DataTable
      columns={columns}
      rowKey={(g) => g.key}
      onRowClick={(g) => toggle(g.key)}
      renderExpanded={(g) =>
        open.has(g.key) ? (
          <ul className="divide-y divide-edge/60">
            {g.connections.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 pl-[54px] pr-4 text-[12px]">
                <span>{c.name}</span>
                <span className="ml-auto text-ink-faint">{c.workspaceName || 'No workspace'}</span>
              </li>
            ))}
          </ul>
        ) : null
      }
      className="mt-3"
      {...table}
      // A dialog pages five owners at a time; a rows-per-page menu would only
      // drop out of the modal's scrolling body.
      onPageSizeChange={undefined}
    />
  )
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
        <div className={usage.warn ? 'text-amber' : 'text-ink'}>{usage.line}</div>
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

// What still uses an engine the admin tried to turn off, grouped by owner, and
// the way on: turn it off anyway — the connections are locked, not deleted, and
// the confirm step notifies their owners (one email each). An instance admin
// can't open workspace connections, so each owner's row names where theirs live.
function InUseDialog({
  module: m,
  connections,
  busy,
  onForce,
  onClose,
}: {
  module: AdminModule
  connections: BlockingConnection[]
  busy: boolean
  onForce: (notify: boolean) => void
  onClose: () => void
}) {
  const [step, setStep] = useState<'list' | 'confirm'>('list')
  const [notify, setNotify] = useState(true)
  const n = connections.length
  const workspaces = new Set(connections.map((c) => c.workspaceId)).size
  const groups = byOwner(connections)
  const owners = groups.filter((g) => g.email).length

  if (step === 'confirm') {
    return (
      <Modal title={`Turn off ${m.label} and lock ${plural(n, 'connection')}?`} onClose={onClose} width={520}>
        <p className="text-[12px] leading-relaxed text-ink-dim">
          {n === 1 ? 'The connection stays' : `All ${n} connections stay`} exactly as {n === 1 ? 'it is' : 'they are'}, but
          locked: nobody can open, edit, export or back {n === 1 ? 'it' : 'them'} up, and scheduled workflows and backups on{' '}
          {n === 1 ? 'it' : 'them'} are skipped. Owners can still delete {n === 1 ? 'it' : 'them'}. Turning {m.label} back on
          unlocks everything as it was.
        </p>
        <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-[12px]">
          <Checkbox checked={notify} onChange={setNotify} ariaLabel="Notify the owners" disabled={!owners} />
          Notify {owners === 1 ? 'the owner' : `the ${plural(owners, 'owner')}`} by email that {n === 1 ? 'their connection is' : 'their connections are'} locked
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="subtle" size="sm" disabled={busy} onClick={() => setStep('list')}>
            Back
          </Button>
          <Button variant="primary" size="sm" className="!bg-red !text-white hover:!bg-red/90" disabled={busy} onClick={() => onForce(notify)}>
            {busy ? 'Turning off…' : `Turn off and lock ${plural(n, 'connection')}`}
          </Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={`${m.label} is still in use`} onClose={onClose} width={600}>
      <p className="text-[12px] leading-relaxed text-ink-dim">
        {plural(n, 'connection')} in {plural(workspaces, 'workspace')} still {n === 1 ? 'uses' : 'use'} {m.label}. Turning it
        off anyway locks them — nothing is deleted — and notifies {owners === 1 ? 'the owner' : `the ${plural(owners, 'owner')}`}{' '}
        with one email each, listing their connections.
      </p>
      <OwnersTable groups={groups} />
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="subtle" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" size="sm" onClick={() => setStep('confirm')}>
          Turn off anyway
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
