import { useState } from 'react'
import { useConnections } from '../stores/ConnectionsContext'
import { BackupConfigForm } from '@/features/backup'
import { useToast } from '@/shared/ui/feedback/Toast'
import { ChevronLeft, CloseIcon, DbLogo, EyeIcon, EyeOffIcon, PlusSmall, ShieldIcon } from '@/shared/ui/icons'
import Select from '@/shared/ui/form/Select'
import NumberStepper from '@/shared/ui/form/NumberStepper'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import Tab from '@/shared/ui/navigation/Tab'
import { controlClass, Input } from '@/shared/ui/form/Input'
import { Label } from '@/shared/ui/form/Form'

const DB_TYPES = [
  { id: 'sqlite', label: 'SQLite', abbr: 'SQ', defaultPort: '' },
  { id: 'postgresql', label: 'PostgreSQL', abbr: 'PG', defaultPort: '5432' },
  { id: 'redis', label: 'Redis', abbr: 'RD', defaultPort: '6379' },
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
  maxSessions: 0,
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
  folder: '',
  tags: [],
  maxSessions: 0,
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
  folder: '',
  tags: [],
  maxSessions: 0,
}

const blankFor = (type) => (type === 'postgresql' ? blankPostgres : type === 'redis' ? blankRedis : blankSqlite)

const fieldRow = 'grid grid-cols-[2fr_1fr] gap-3.5 max-[720px]:grid-cols-1'

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

// Full-page create/edit connection form (General / SSH·SSL / Backup tabs —
// Backup only once the connection exists). Replaces the old slide-over modal;
// rendered inline by ConnectionsPage the same way ConnectionDetail is.
export default function ConnectionForm({ initial, initialType, initialTab, onClose, onSave }) {
  const { testConnection } = useConnections()
  const toast = useToast()
  const isEdit = !!initial

  const [form, setForm] = useState(() => {
    if (initial) return { ...blankFor(initial.type), ...initial }
    return blankFor(initialType)
  })
  const [tab, setTab] = useState(initialTab || 'general') // general | ssh | backup
  const [showPassword, setShowPassword] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [test, setTest] = useState(null) // { ok, message } | 'loading'
  const [saving, setSaving] = useState(false)

  const isSqlite = form.type === 'sqlite'
  const isRedis = form.type === 'redis'
  // Only the dump-based engines can be backed up; Redis has no SQL export.
  const backupSupported = isEdit && (form.type === 'sqlite' || form.type === 'postgresql')
  const tabs = [
    { id: 'general', label: 'General' },
    ...(isSqlite ? [] : [{ id: 'ssh', label: isRedis ? 'TLS' : 'SSH / SSL' }]),
    ...(backupSupported ? [{ id: 'backup', label: 'Backup' }] : []),
  ]

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

  const pickType = (t) => {
    setForm((f) => ({ ...blankFor(t.id), name: f.name, folder: f.folder, tags: f.tags }))
    setTab('general')
    setTest(null)
  }

  const addTag = () => {
    const v = tagDraft.trim()
    if (v && !(form.tags || []).includes(v)) setForm((f) => ({ ...f, tags: [...(f.tags || []), v] }))
    setTagDraft('')
  }
  const removeTag = (t) => setForm((f) => ({ ...f, tags: (f.tags || []).filter((x) => x !== t) }))

  const valid = form.name.trim() && (isSqlite ? form.filepath.trim() : form.host.trim() && form.port.trim())

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
      host: form.host?.trim() || '',
      port: form.port?.trim() || '',
      filepath: form.filepath?.trim() || '',
      database: form.database?.trim() || '',
      folder: form.folder.trim(),
      maxSessions: Math.max(0, parseInt(form.maxSessions, 10) || 0),
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

  return (
    <div className="w-full">
      <TextButton onClick={onClose} className="mb-5">
        <ChevronLeft width={16} height={16} /> All connections
      </TextButton>

      <h1 className="text-[22px] font-bold tracking-[-0.4px]">{isEdit ? 'Edit Connection' : 'New Connection'}</h1>

      {tabs.length > 1 && (
        <div className="mt-6 flex items-center gap-5 border-b border-edge">
          {tabs.map((t) => (
            <Tab key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </Tab>
          ))}
        </div>
      )}

      <div className="mt-6 max-w-[640px]">
        {tab === 'backup' ? (
          <BackupConfigForm connectionId={initial.id} connectionType={form.type} workspaceId={initial.workspaceId} />
        ) : (
          <>
            <div className="mb-[22px] grid grid-cols-3 gap-3 max-[480px]:grid-cols-1">
              {DB_TYPES.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => pickType(t)}
                  className={`flex items-center gap-3 rounded-soft border p-3.5 transition-all ${
                    form.type === t.id
                      ? 'border-green bg-card-hover shadow-[0_0_0_3px_rgba(111,207,106,0.22)]'
                      : 'border-edge bg-elevated hover:border-edge-strong'
                  }`}
                >
                  <DbLogo type={t.id} className="h-9 w-9 shrink-0" />
                  <span className="text-[11px] font-semibold">{t.label}</span>
                </button>
              ))}
            </div>

            <div className="mb-[18px]">
              <Label>Connection Name</Label>
              <Input
                type="text"
                placeholder={isSqlite ? 'e.g. Demo DB' : 'My Production Database'}
                value={form.name}
                onChange={set('name')}
                required
              />
            </div>

            {/* Tags */}
            <div className="mb-[18px] flex flex-wrap items-center gap-2">
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

            {isSqlite ? (
              <div className="mb-[18px]">
                <Label>Database File Path</Label>
                <Input
                  type="text"
                  placeholder="./demo.db"
                  value={form.filepath}
                  onChange={set('filepath')}
                  required
                />
              </div>
            ) : tab === 'general' ? (
              <>
                <div className="mb-[18px]">
                  <Label>Connection URI</Label>
                  <Input
                    className="font-mono"
                    type="text"
                    placeholder={
                      isRedis ? 'redis://user:password@host:6379/0' : 'postgresql://user:password@host:5432/database'
                    }
                    value={form.uri || ''}
                    onChange={onUriChange}
                  />
                </div>

                <div className="my-4 flex items-center gap-3 text-[11px] text-ink-faint">
                  <span className="h-px flex-1 bg-edge" /> or <span className="h-px flex-1 bg-edge" />
                </div>

                <div className={fieldRow}>
                  <div className="mb-[18px]">
                    <Label>Host</Label>
                    <Input type="text" placeholder="localhost" value={form.host} onChange={set('host')} required />
                  </div>
                  <div className="mb-[18px]">
                    <Label>Port</Label>
                    <Input type="text" placeholder={isRedis ? '6379' : '5432'} value={form.port} onChange={set('port')} required />
                  </div>
                </div>

                <div className="mb-[18px]">
                  <Label>Authentication</Label>
                  <Select className={controlClass} value={form.auth || 'password'} onChange={(v) => setVal('auth', v)} options={AUTH_MODES} />
                </div>

                {(form.auth || 'password') === 'password' && (
                  <>
                    <div className="mb-[18px]">
                      <Label>
                        User{isRedis && <span className="text-ink-faint"> (ACL — leave empty for a password-only server)</span>}
                      </Label>
                      <Input
                        type="text"
                        placeholder={isRedis ? 'default' : 'postgres'}
                        value={form.username}
                        onChange={set('username')}
                      />
                    </div>

                    <div className="mb-2">
                      <Label>Password</Label>
                      <div className="relative">
                        <Input
                          className="pr-10"
                          type={showPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          value={form.password}
                          onChange={set('password')}
                        />
                        <TextButton
                          tone="faint"
                          className="absolute right-3 top-1/2 -translate-y-1/2"
                          onClick={() => setShowPassword((s) => !s)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                        </TextButton>
                      </div>
                    </div>

                    <TextButton tone={form.keychain ? 'green' : 'faint'} className="mb-[18px] !text-[11px]" onClick={() => setVal('keychain', !form.keychain)}>
                      <ShieldIcon width={14} height={14} /> Enable keychain
                    </TextButton>
                  </>
                )}

                <div className="mb-[18px]">
                  <Label>
                    {isRedis ? 'Database index' : 'Database'} <span className="text-ink-faint">(optional)</span>
                  </Label>
                  <Input
                    type="text"
                    placeholder={isRedis ? '0' : 'Leave empty to select database after connecting'}
                    value={form.database}
                    onChange={set('database')}
                  />
                  {isRedis && (
                    <p className="mt-2 text-[11px] text-ink-faint">
                      The numeric database to open by default (0–15 on a stock server). You can switch databases from the
                      console.
                    </p>
                  )}
                </div>
              </>
            ) : isRedis ? (
              <div className="mb-[18px]">
                <Label>TLS</Label>
                <Select className={controlClass} value={form.tls || ''} onChange={(v) => setVal('tls', v)} options={TLS_MODES} />
                <p className="mt-2 text-[11px] text-ink-faint">
                  Managed Redis (ElastiCache in-transit encryption, Upstash, Redis Cloud) requires TLS — the same thing a{' '}
                  <span className="text-ink-dim">rediss://</span> URI selects. Only skip verification for self-signed
                  certificates you trust.
                </p>
              </div>
            ) : (
              <div className="mb-[18px]">
                <Label>SSL Mode</Label>
                <Select
                  className={controlClass}
                  value={form.sslmode || 'disable'}
                  onChange={(v) => setVal('sslmode', v)}
                  options={SSL_MODES.map((m) => ({ value: m, label: m }))}
                />
                <p className="mt-2 text-[11px] text-ink-faint">
                  Choose how the client negotiates SSL with the server. Use <span className="text-ink-dim">require</span> or{' '}
                  <span className="text-ink-dim">verify-full</span> for production databases.
                </p>
              </div>
            )}

            <div className={fieldRow}>
              <div className="mb-[18px]">
                <Label>Environment</Label>
                <Select
                  className={controlClass}
                  value={form.environment}
                  onChange={(v) => setVal('environment', v)}
                  options={ENVIRONMENTS.map((env) => ({ value: env, label: env[0].toUpperCase() + env.slice(1) }))}
                />
              </div>
              <div className="mb-[18px]">
                <Label>
                  Folder <span className="text-ink-faint">(optional)</span>
                </Label>
                <Input type="text" placeholder="e.g. Demo" value={form.folder} onChange={set('folder')} />
              </div>
            </div>

            <div className="mb-[18px] max-w-[260px]">
              <Label>
                Max concurrent sessions <span className="text-ink-faint">(0 = workspace default)</span>
              </Label>
              <NumberStepper
                value={Number(form.maxSessions) || 0}
                min={0}
                max={999}
                ariaLabel="Max concurrent sessions"
                onChange={(n) => setVal('maxSessions', n || 0)}
              />
              <p className="mt-2 text-[11px] text-ink-faint">
                Caps how many connections to this database the app keeps open at once (one per database it browses).
                Leave at 0 to inherit the workspace default.
              </p>
            </div>

            {test && test !== 'loading' && (
              <div
                className={`mt-1 mb-[18px] rounded-soft px-3.5 py-2.5 text-[11px] font-medium ${
                  test.ok ? 'border border-green-dim bg-green/10 text-green-bright' : 'border border-red/25 bg-red/10 text-[#ff9b9b]'
                }`}
              >
                {test.ok ? '✓ ' : '✕ '}
                {test.message}
              </div>
            )}

            <div className="flex justify-end gap-3 pb-8 pt-2">
              <Button type="button" variant="ghost" size="lg" onClick={runTest} disabled={!valid || test === 'loading' || saving}>
                {test === 'loading' ? 'Testing…' : 'Test Connection'}
              </Button>
              <Button type="button" variant="primary" size="lg" onClick={handleSave} disabled={!valid || saving}>
                {saving ? 'Connecting…' : `${isEdit ? 'Update' : 'Create'} Connection`}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
