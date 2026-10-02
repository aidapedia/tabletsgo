import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useConnections } from '../stores/ConnectionsContext'
import { BackupConfigForm } from '@/features/backup'
import { addressOf, listSshGateways, type SshGateway } from '@/features/ssh'
import { useWorkspaces } from '@/features/workspaces'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CloseIcon, DbLogo, GlobeIcon, PlusSmall, ShieldIcon, TerminalIcon } from '@/shared/ui/icons'
import Select from '@/shared/ui/form/Select'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import PageHeader from '@/shared/ui/page/PageHeader'
import PageTabs from '@/shared/ui/page/PageTabs'
import Narrow from '@/shared/ui/page/Narrow'
import { controlClass, Input } from '@/shared/ui/form/Input'
import PasswordInput from '@/shared/ui/form/PasswordInput'
import { FormField } from '@/shared/ui/form/Form'

const DB_TYPES = [
  { id: 'sqlite', label: 'SQLite', desc: 'A database file on this server', defaultPort: '' },
  { id: 'postgresql', label: 'PostgreSQL', desc: 'Relational, over the network', defaultPort: '5432' },
  { id: 'redis', label: 'Redis', desc: 'Key-value, over the network', defaultPort: '6379' },
]

// How a network database is reached. Stored as `sshGatewayId` — empty means
// direct — so this is a UI choice, not a field of the record.
const METHODS = [
  {
    id: 'direct',
    label: 'Direct',
    desc: 'Tabletsgo dials the database host itself.',
    icon: GlobeIcon,
  },
  {
    id: 'ssh',
    label: 'Over SSH tunnel',
    desc: 'Log in to an SSH host first, then reach the database from there.',
    icon: TerminalIcon,
  },
]

const ENVIRONMENTS = ['development', 'staging', 'production', 'local']
const AUTH_MODES = [
  { value: 'password', label: 'User & Password' },
  { value: 'none', label: 'No authentication' },
]
const SSL_MODES = ['disable', 'allow', 'prefer', 'require', 'verify-full']
// Redis's equivalent of sslmode — plain TCP, TLS, or TLS without cert checks.
const TLS_MODES = [
  { value: '', label: 'Disabled (plain TCP)' },
  { value: 'require', label: 'Enabled (verify certificate)' },
  { value: 'insecure', label: 'Enabled (skip verification)' },
]

const blankSqlite = {
  name: '',
  type: 'sqlite',
  environment: 'local',
  filepath: '',
  folder: '',
  tags: [],
}

const blankPostgres = {
  name: '',
  type: 'postgresql',
  environment: 'development',
  uri: '',
  host: '',
  port: '5432',
  auth: 'password',
  username: 'postgres',
  password: '',
  database: '',
  sslmode: 'disable',
  keychain: false,
  sshGatewayId: '',
  folder: '',
  tags: [],
}

// Redis reuses the same field names as Postgres — host/port/username/password —
// so nothing downstream (encryption, export/import, the detail view) needs a
// Redis-specific branch. `database` is the numeric db index and `tls` its SSL.
const blankRedis = {
  name: '',
  type: 'redis',
  environment: 'development',
  uri: '',
  host: '',
  port: '6379',
  auth: 'password',
  username: '',
  password: '',
  database: '0',
  tls: '',
  keychain: false,
  sshGatewayId: '',
  folder: '',
  tags: [],
}

const blankFor = (type) => (type === 'postgresql' ? blankPostgres : type === 'redis' ? blankRedis : blankSqlite)

// A row of fields owns the gap below it — FormField drops its own margin inside
// a grid (see `.form-field` in index.css).
const fieldRow = 'mb-4 grid grid-cols-[2fr_1fr] gap-3.5 max-[720px]:grid-cols-1'

// Parse a postgres:// or redis:// URI into structured fields. Returns null if it
// doesn't parse (or isn't the URI scheme for `type`).
function parseUri(uri, type) {
  try {
    const u = new URL(uri)
    const isRedis = /^rediss?:$/.test(u.protocol)
    if (type === 'redis' ? !isRedis : !/^postgres(ql)?:$/.test(u.protocol)) return null
    const q = u.searchParams
    const extra: any = {}
    if (q.get('name')) extra.name = q.get('name')
    if (q.get('env')) extra.environment = q.get('env')
    // Redis puts the db index in the path (redis://host:6379/2); Postgres puts
    // the database name there. Either way it lands in `database`.
    const pathPart = u.pathname ? decodeURIComponent(u.pathname.replace(/^\//, '')) : ''
    if (isRedis) {
      extra.tls = u.protocol === 'rediss:' ? 'require' : ''
      extra.database = pathPart || '0'
    } else {
      extra.database = pathPart
      if (q.get('sslmode')) extra.sslmode = q.get('sslmode')
    }
    return {
      host: u.hostname || '',
      port: u.port || (isRedis ? '6379' : '5432'),
      username: decodeURIComponent(u.username || ''),
      password: decodeURIComponent(u.password || ''),
      ...extra,
    }
  } catch {
    return null
  }
}

// One titled block of the form. The steps read top to bottom in the order you
// need them: what it is, what to call it, how to reach it, how to log in.
function FormSection({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-edge pt-5 pb-2 first:border-t-0 first:pt-0">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {desc && <p className="mt-0.5 text-[11px] text-ink-faint">{desc}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

// A selectable card: the database engine and the connection method are both
// picked from a small set of these.
function OptionCard({
  selected,
  onClick,
  icon,
  title,
  desc,
}: {
  selected: boolean
  onClick?: () => void
  icon: ReactNode
  title: string
  desc?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex items-center gap-3 rounded-soft border p-3.5 text-left transition-all ${
        selected
          ? 'border-green bg-card-hover shadow-[0_0_0_3px_rgba(111,207,106,0.22)]'
          : 'border-edge bg-elevated hover:border-edge-strong'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold">{title}</span>
        {desc && <span className="mt-0.5 block text-[11px] leading-snug text-ink-dim">{desc}</span>}
      </span>
    </button>
  )
}

// Full-page create/edit connection form (General / Backup tabs — Backup only
// once the connection exists). General holds everything that identifies and
// reaches the database, SSL/TLS included. Its own route, like the detail view:
// the page owns the tab so `/connections/:id/edit/backup` is a real address.
//
// The engine is chosen once, at creation: everything filed under a connection
// (dashboards, workflows, schema history) is written for it, so editing shows it
// locked and the server refuses a change.
//
// `onClose` is where cancelling lands (the record being edited, or the list for
// a new one); `onList` is the list itself, which the breadcrumb needs as its
// root even when it isn't where cancelling goes.
export default function ConnectionForm({ initial, initialType, tab = 'general', onTab, onClose, onList, onSave }) {
  const { testConnection } = useConnections()
  const toast = useToast()
  const isEdit = !!initial

  const [form, setForm] = useState(() => {
    if (initial) return { ...blankFor(initial.type), ...initial }
    return blankFor(initialType)
  })
  // Direct or tunnelled. Kept apart from `sshGatewayId` so "over SSH" can be
  // chosen before a host is picked.
  const [via, setVia] = useState(initial?.sshGatewayId ? 'ssh' : 'direct')
  const [tagDraft, setTagDraft] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [test, setTest] = useState(null) // { ok, message } | 'loading'
  const [saving, setSaving] = useState(false)

  const isSqlite = form.type === 'sqlite'
  const isRedis = form.type === 'redis'
  const viaSsh = !isSqlite && via === 'ssh'

  // The gateways a network connection may tunnel through — this workspace's.
  const { current } = useWorkspaces()
  const workspaceId = initial?.workspaceId || current?.id
  const [gateways, setGateways] = useState<SshGateway[]>([])
  useEffect(() => {
    if (workspaceId) listSshGateways(workspaceId).then(setGateways)
  }, [workspaceId])
  // Only the dump-based engines can be backed up; Redis has no SQL export.
  const backupSupported = isEdit && (form.type === 'sqlite' || form.type === 'postgresql')
  const tabs = [
    { id: 'general', label: 'General' },
    ...(backupSupported ? [{ id: 'backup', label: 'Backup' }] : []),
  ]
  const activeTab = tabs.some((t) => t.id === tab) ? tab : 'general'

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
    setTest(null)
  }
  const setVal = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    setTest(null)
  }

  const onUriChange = (e) => {
    const uri = e.target.value
    const parsed = parseUri(uri, form.type)
    setForm((f) => ({ ...f, uri, ...(parsed || {}) }))
    setTest(null)
  }

  const pickType = (id) => {
    if (isEdit) return
    setForm((f) => ({ ...blankFor(id), name: f.name, folder: f.folder, tags: f.tags }))
    setVia('direct')
    setTest(null)
  }

  // Leaving the tunnel clears the host; entering it preselects the only one
  // there is, so the common single-bastion case is one click.
  const pickVia = (id) => {
    setVia(id)
    setVal('sshGatewayId', id === 'ssh' ? form.sshGatewayId || (gateways.length === 1 ? gateways[0].id : '') : '')
  }

  const addTag = () => {
    const v = tagDraft.trim()
    if (v && !(form.tags || []).includes(v)) setForm((f) => ({ ...f, tags: [...(f.tags || []), v] }))
    setTagDraft('')
  }
  const removeTag = (t) => setForm((f) => ({ ...f, tags: (f.tags || []).filter((x) => x !== t) }))

  const valid =
    form.name.trim() &&
    // Through a tunnel an empty host means the SSH host itself (the server dials
    // 127.0.0.1 from there), so only a direct connection must name one.
    (isSqlite
      ? form.filepath.trim()
      : form.port.trim() && (viaSsh ? form.sshGatewayId : form.host.trim()))

  const runTest = async () => {
    if (!valid) return
    setTest('loading')
    const result = await testConnection(form)
    setTest(result)
    if (result?.ok) toast.success(result.message || 'Connection successful!')
    else toast.error(result?.message || 'Connection failed')
  }

  const handleSave = async () => {
    if (!valid || saving) return
    const payload = {
      ...form,
      name: form.name.trim(),
      // Spell out the tunnel's default so the detail view and lists show where
      // it actually goes.
      host: form.host?.trim() || (viaSsh ? '127.0.0.1' : ''),
      port: form.port?.trim() || '',
      filepath: form.filepath?.trim() || '',
      database: form.database?.trim() || '',
      folder: form.folder.trim(),
    }
    // Verify the connection works before saving so we never store a broken one.
    setSaving(true)
    const result = await testConnection(payload)
    setSaving(false)
    if (!result?.ok) {
      setTest(result || { ok: false, message: 'Connection test failed' })
      toast.error(result?.message || 'Connection failed')
      return
    }
    setTest(result)
    toast.success(`Connected — saving "${payload.name}".`)
    onSave(payload)
  }

  const tags = form.tags || []
  const engine = DB_TYPES.find((t) => t.id === form.type)

  const general = (
    <>
      <FormSection
        title="Database"
        desc={
          isEdit
            ? 'The engine is fixed once a connection exists — create a new connection to use a different one.'
            : 'The engine you are connecting to. It cannot be changed later.'
        }
      >
        {isEdit ? (
          <div className="mb-4 flex items-center gap-3 rounded-soft border border-edge bg-elevated p-3.5">
            <DbLogo type={form.type} className="h-9 w-9 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold">{engine?.label || form.type}</div>
              {engine && <div className="mt-0.5 text-[11px] text-ink-dim">{engine.desc}</div>}
            </div>
            <span className="rounded-[6px] border border-edge px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">
              Locked
            </span>
          </div>
        ) : (
          <div className="mb-4 grid grid-cols-3 gap-3 max-[560px]:grid-cols-1">
            {DB_TYPES.map((t) => (
              <OptionCard
                key={t.id}
                selected={form.type === t.id}
                onClick={() => pickType(t.id)}
                icon={<DbLogo type={t.id} className="h-9 w-9" />}
                title={t.label}
              />
            ))}
          </div>
        )}
      </FormSection>

      <FormSection title="Details">
        <FormField label="Connection name">
          <Input
            type="text"
            placeholder={isSqlite ? 'e.g. Demo DB' : 'My Production Database'}
            value={form.name}
            onChange={set('name')}
            required
          />
        </FormField>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-edge bg-elevated px-2.5 py-1 text-[11px] text-ink-dim"
            >
              {t}
              <TextButton tone="faint" className="hover:!text-red" onClick={() => removeTag(t)}>
                <CloseIcon width={11} height={11} />
              </TextButton>
            </span>
          ))}
          {addingTag ? (
            <input
              autoFocus
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addTag()
                } else if (e.key === 'Escape') {
                  setTagDraft('')
                  setAddingTag(false)
                }
              }}
              onBlur={() => {
                addTag()
                setAddingTag(false)
              }}
              placeholder="tag name"
              className="w-[120px] rounded-[8px] border border-edge bg-elevated px-2.5 py-1 text-[11px] text-ink outline-none focus:border-green-dim"
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingTag(true)}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-dashed border-edge-strong px-2.5 py-1 text-[11px] text-ink-dim hover:border-green-dim hover:text-ink"
            >
              <PlusSmall width={12} height={12} /> Add tags
            </button>
          )}
        </div>

        <div className={fieldRow}>
          <FormField label="Environment">
            <Select
              className={controlClass}
              value={form.environment}
              onChange={(v) => setVal('environment', v)}
              options={ENVIRONMENTS.map((env) => ({ value: env, label: env[0].toUpperCase() + env.slice(1) }))}
            />
          </FormField>
          <FormField
            label={
              <>
                Folder <span className="text-ink-faint">(optional)</span>
              </>
            }
          >
            <Input type="text" placeholder="e.g. Demo" value={form.folder} onChange={set('folder')} />
          </FormField>
        </div>
      </FormSection>

      {isSqlite ? (
        <FormSection title="Location" desc="SQLite is a file, opened where Tabletsgo runs — there is nothing to tunnel to.">
          <FormField label="Database file path">
            <Input type="text" placeholder="./demo.db" value={form.filepath} onChange={set('filepath')} required />
          </FormField>
        </FormSection>
      ) : (
        <>
          {/* Direct vs tunnelled comes first: it decides what "host" means
              in the fields below it. */}
          <FormSection title="Connect via">
            <div className="mb-4 grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
              {METHODS.map((m) => (
                <OptionCard
                  key={m.id}
                  selected={via === m.id}
                  onClick={() => pickVia(m.id)}
                  icon={
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-[10px] ${
                        via === m.id ? 'bg-green/15 text-green' : 'bg-bg text-ink-dim'
                      }`}
                    >
                      <m.icon width={18} height={18} />
                    </span>
                  }
                  title={m.label}
                  desc={m.desc}
                />
              ))}
            </div>

            {viaSsh &&
              (gateways.length ? (
                <FormField
                  label="SSH host"
                  hint="Tabletsgo logs in here and forwards the database port through it."
                >
                  <Select
                    className={controlClass}
                    value={form.sshGatewayId || ''}
                    onChange={(v) => setVal('sshGatewayId', v)}
                    placeholder="Choose an SSH host"
                    options={gateways.map((g) => ({ value: g.id, label: g.name, hint: addressOf(g) }))}
                  />
                </FormField>
              ) : (
                <div className="mb-4 rounded-soft border border-dashed border-edge-strong px-3.5 py-3 text-[11px] text-ink-dim">
                  No SSH hosts in this workspace yet.{' '}
                  <Link to="/ssh/hosts" className="text-ink underline hover:text-green">
                    Add one under SSH → Host
                  </Link>
                  , then come back to pick it.
                </div>
              ))}
          </FormSection>

          <FormSection
            title="Server"
            desc={
              viaSsh ? (
                <>
                  Dialed <span className="text-ink-dim">from the SSH host</span>. Leave the host empty when the database runs on the
                  SSH host itself; otherwise use the address it sees (a private IP or internal hostname).
                </>
              ) : (
                'Paste a URI to fill the fields, or enter them yourself.'
              )
            }
          >
            <FormField label="Connection URI">
              <Input
                className="font-mono"
                type="text"
                placeholder={isRedis ? 'redis://user:password@host:6379/0' : 'postgresql://user:password@host:5432/database'}
                value={form.uri || ''}
                onChange={onUriChange}
              />
            </FormField>

            <div className="mb-4 flex items-center gap-3 text-[11px] text-ink-faint">
              <span className="h-px flex-1 bg-edge" /> or <span className="h-px flex-1 bg-edge" />
            </div>

            <div className={fieldRow}>
              <FormField
                label={
                  viaSsh ? (
                    <>
                      Host <span className="text-ink-faint">(optional)</span>
                    </>
                  ) : (
                    'Host'
                  )
                }
              >
                <Input
                  type="text"
                  placeholder={viaSsh ? '127.0.0.1 — the SSH host itself' : 'localhost'}
                  value={form.host}
                  onChange={set('host')}
                  required={!viaSsh}
                />
              </FormField>
              <FormField label="Port">
                <Input type="text" placeholder={isRedis ? '6379' : '5432'} value={form.port} onChange={set('port')} required />
              </FormField>
            </div>

            <FormField
              label={
                <>
                  {isRedis ? 'Database index' : 'Database'} <span className="text-ink-faint">(optional)</span>
                </>
              }
              hint={
                isRedis
                  ? 'The numeric database to open by default (0–15 on a stock server). You can switch databases from the console.'
                  : undefined
              }
            >
              <Input
                type="text"
                placeholder={isRedis ? '0' : 'Leave empty to select database after connecting'}
                value={form.database}
                onChange={set('database')}
              />
            </FormField>
          </FormSection>

          <FormSection title="Authentication">
            <FormField label="Method">
              <Select
                className={controlClass}
                value={form.auth || 'password'}
                onChange={(v) => setVal('auth', v)}
                options={AUTH_MODES}
              />
            </FormField>

            {(form.auth || 'password') === 'password' && (
              <>
                <FormField
                  label={
                    <>
                      User{isRedis && <span className="text-ink-faint"> (ACL — leave empty for a password-only server)</span>}
                    </>
                  }
                >
                  <Input
                    type="text"
                    placeholder={isRedis ? 'default' : 'postgres'}
                    value={form.username}
                    onChange={set('username')}
                  />
                </FormField>

                <FormField label="Password" className="!mb-2">
                  <PasswordInput placeholder="••••••••" value={form.password} onChange={set('password')} />
                </FormField>

                <TextButton
                  tone={form.keychain ? 'green' : 'faint'}
                  className="mb-4 !text-[11px]"
                  onClick={() => setVal('keychain', !form.keychain)}
                >
                  <ShieldIcon width={14} height={14} /> Enable keychain
                </TextButton>
              </>
            )}
          </FormSection>

          {/* Transport security between Tabletsgo (or the tunnel's end) and
              the database itself. */}
          <FormSection title="Security">
            {isRedis ? (
              <FormField
                label="TLS"
                hint={
                  <>
                    Managed Redis (ElastiCache in-transit encryption, Upstash, Redis Cloud) requires TLS — the same thing a{' '}
                    <span className="text-ink-dim">rediss://</span> URI selects. Only skip verification for self-signed
                    certificates you trust.
                  </>
                }
              >
                <Select className={controlClass} value={form.tls || ''} onChange={(v) => setVal('tls', v)} options={TLS_MODES} />
              </FormField>
            ) : (
              <FormField
                label="SSL mode"
                hint={
                  <>
                    Choose how the client negotiates SSL with the server. Use <span className="text-ink-dim">require</span> or{' '}
                    <span className="text-ink-dim">verify-full</span> for production databases.
                  </>
                }
              >
                <Select
                  className={controlClass}
                  value={form.sslmode || 'disable'}
                  onChange={(v) => setVal('sslmode', v)}
                  options={SSL_MODES.map((m) => ({ value: m, label: m }))}
                />
              </FormField>
            )}
          </FormSection>
        </>
      )}

      {test && test !== 'loading' && (
        <div
          className={`mt-1 mb-4 rounded-soft px-3.5 py-2.5 text-[11px] font-medium ${
            test.ok ? 'border border-green-dim bg-green/10 text-green-bright' : 'border border-red/25 bg-red/10 text-[#ff9b9b]'
          }`}
        >
          {test.ok ? '✓ ' : '✕ '}
          {test.message}
        </div>
      )}

      <div className="flex justify-end gap-3 border-t border-edge pb-8 pt-5">
        <Button type="button" variant="ghost" size="lg" onClick={runTest} disabled={!valid || test === 'loading' || saving}>
          {test === 'loading' ? 'Testing…' : 'Test Connection'}
        </Button>
        <Button type="button" variant="primary" size="lg" onClick={handleSave} disabled={!valid || saving}>
          {saving ? 'Connecting…' : `${isEdit ? 'Update' : 'Create'} Connection`}
        </Button>
      </div>
    </>
  )

  const body = (
    <Narrow width={640}>
      {activeTab === 'backup' ? (
        <BackupConfigForm connectionId={initial.id} connectionType={form.type} workspaceId={initial.workspaceId} />
      ) : (
        general
      )}
    </Narrow>
  )

  return (
    <div className="w-full">
      <PageHeader
        crumbs={[
          { label: 'Connections', onClick: onList || onClose },
          // Editing sits under the connection it edits; a new one has no record
          // to sit under yet, so the trail is one level shorter.
          ...(isEdit ? [{ label: initial.name, onClick: onClose }] : []),
          { label: isEdit ? 'Edit' : 'New connection' },
        ]}
        title={isEdit ? 'Edit connection' : 'New connection'}
        desc={
          isEdit
            ? 'Update how Tabletsgo reaches this database.'
            : 'Point Tabletsgo at a database — it is tested before it is saved.'
        }
      />

      {/* One tab means no tab bar: a new connection has nothing to back up yet. */}
      {tabs.length > 1 ? (
        <PageTabs tabs={tabs} active={activeTab} onTab={(id) => onTab?.(id)}>
          {body}
        </PageTabs>
      ) : (
        <div className="mt-7">{body}</div>
      )}
    </div>
  )
}
