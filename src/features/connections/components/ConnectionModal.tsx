import { useState } from 'react'
import { useConnections } from '../stores/ConnectionsContext'
import { useToast } from '@/shared/ui/Toast'
import { CloseIcon, DbLogo, EyeIcon, EyeOffIcon, PlusSmall, ShieldIcon } from '@/shared/ui/icons'
import Select from '@/shared/ui/Select'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import Button from '@/shared/ui/Button'
import { fieldInput, fieldLabel } from '@/shared/lib/styles'

const DB_TYPES = [
  { id: 'sqlite', label: 'SQLite', abbr: 'SQ', defaultPort: '' },
  { id: 'postgresql', label: 'PostgreSQL', abbr: 'PG', defaultPort: '5432' },
]

const ENVIRONMENTS = ['development', 'staging', 'production', 'local']
const AUTH_MODES = [
  { value: 'password', label: 'User & Password' },
  { value: 'none', label: 'No authentication' },
]
const SSL_MODES = ['disable', 'allow', 'prefer', 'require', 'verify-full']

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
  folder: '',
  tags: [],
}

const fieldRow = 'grid grid-cols-[2fr_1fr] gap-3.5 max-[720px]:grid-cols-1'

// Parse a postgres URI into structured fields. Returns null if it doesn't parse.
function parseUri(uri) {
  try {
    const u = new URL(uri)
    if (!/^postgres(ql)?:$/.test(u.protocol)) return null
    const q = u.searchParams
    const extra: any = {}
    if (q.get('name')) extra.name = q.get('name')
    if (q.get('env')) extra.environment = q.get('env')
    if (q.get('sslmode')) extra.sslmode = q.get('sslmode')
    return {
      host: u.hostname || '',
      port: u.port || '5432',
      username: decodeURIComponent(u.username || ''),
      password: decodeURIComponent(u.password || ''),
      database: u.pathname ? decodeURIComponent(u.pathname.replace(/^\//, '')) : '',
      ...extra,
    }
  } catch {
    return null
  }
}

export default function ConnectionModal({ initial, initialType, onClose, onSave }) {
  const { testConnection } = useConnections()
  const toast = useToast()
  const { show, close } = useSlideOver(onClose)
  const isEdit = !!initial

  const [form, setForm] = useState(() => {
    if (initial) return { ...(initial.type === 'sqlite' ? blankSqlite : blankPostgres), ...initial }
    return initialType === 'postgresql' ? blankPostgres : blankSqlite
  })
  const [tab, setTab] = useState('general') // general | ssh
  const [showPassword, setShowPassword] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [test, setTest] = useState(null) // { ok, message } | 'loading'
  const [saving, setSaving] = useState(false)

  const isSqlite = form.type === 'sqlite'

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
    const parsed = parseUri(uri)
    setForm((f) => ({ ...f, uri, ...(parsed || {}) }))
    setTest(null)
  }

  const pickType = (t) => {
    setForm((f) => ({ ...(t.id === 'sqlite' ? blankSqlite : blankPostgres), name: f.name, folder: f.folder, tags: f.tags }))
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

  const handleSave = async (e) => {
    e.preventDefault()
    if (!valid || saving) return
    const payload = {
      ...form,
      name: form.name.trim(),
      host: form.host?.trim() || '',
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
    toast.success(`Connected — saving “${payload.name}”.`)
    close(() => onSave(payload))
  }

  const tags = form.tags || []

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end bg-black/50 transition-opacity duration-200 ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseDown={() => close()}
    >
      <div
        className={`flex h-full w-full max-w-[520px] flex-col border-l border-edge-strong bg-panel shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.8)] transition-transform duration-200 ease-out ${
          show ? 'translate-x-0' : 'translate-x-full'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSave} className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-edge px-6 py-[18px]">
            <h3 className="text-sm font-bold">{isEdit ? 'Edit Connection' : 'New Connection'}</h3>
            <button
              type="button"
              className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-ink-dim hover:bg-elevated hover:text-ink"
              onClick={() => close()}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="mb-[22px] grid grid-cols-2 gap-3">
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
              <label className={fieldLabel}>Connection Name</label>
              <input
                className={fieldInput}
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
                  <button type="button" onClick={() => removeTag(t)} className="text-ink-faint hover:text-red">
                    <CloseIcon width={11} height={11} />
                  </button>
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
                <label className={fieldLabel}>Database File Path</label>
                <input
                  className={fieldInput}
                  type="text"
                  placeholder="./demo.db"
                  value={form.filepath}
                  onChange={set('filepath')}
                  required
                />
              </div>
            ) : (
              <>
                {/* General / SSH·SSL tabs */}
                <div className="mb-5 flex gap-5 border-b border-edge">
                  {[
                    { id: 'general', label: 'General' },
                    { id: 'ssh', label: 'SSH / SSL' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id)}
                      className={`-mb-px border-b-2 pb-2.5 text-xs font-medium transition-colors ${
                        tab === t.id ? 'border-ink text-ink' : 'border-transparent text-ink-dim hover:text-ink'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {tab === 'general' ? (
                  <>
                    <div className="mb-[18px]">
                      <label className={fieldLabel}>Connection URI</label>
                      <input
                        className={`${fieldInput} font-mono`}
                        type="text"
                        placeholder="postgresql://user:password@host:5432/database"
                        value={form.uri || ''}
                        onChange={onUriChange}
                      />
                    </div>

                    <div className="my-4 flex items-center gap-3 text-[11px] text-ink-faint">
                      <span className="h-px flex-1 bg-edge" /> or <span className="h-px flex-1 bg-edge" />
                    </div>

                    <div className={fieldRow}>
                      <div className="mb-[18px]">
                        <label className={fieldLabel}>Host</label>
                        <input
                          className={fieldInput}
                          type="text"
                          placeholder="localhost"
                          value={form.host}
                          onChange={set('host')}
                          required
                        />
                      </div>
                      <div className="mb-[18px]">
                        <label className={fieldLabel}>Port</label>
                        <input
                          className={fieldInput}
                          type="text"
                          placeholder="5432"
                          value={form.port}
                          onChange={set('port')}
                          required
                        />
                      </div>
                    </div>

                    <div className="mb-[18px]">
                      <label className={fieldLabel}>Authentication</label>
                      <Select
                        className={fieldInput}
                        value={form.auth || 'password'}
                        onChange={(v) => setVal('auth', v)}
                        options={AUTH_MODES}
                      />
                    </div>

                    {(form.auth || 'password') === 'password' && (
                      <>
                        <div className="mb-[18px]">
                          <label className={fieldLabel}>User</label>
                          <input
                            className={fieldInput}
                            type="text"
                            placeholder="postgres"
                            value={form.username}
                            onChange={set('username')}
                          />
                        </div>

                        <div className="mb-2">
                          <label className={fieldLabel}>Password</label>
                          <div className="relative">
                            <input
                              className={`${fieldInput} pr-10`}
                              type={showPassword ? 'text' : 'password'}
                              placeholder="••••••••"
                              value={form.password}
                              onChange={set('password')}
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword((s) => !s)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
                              aria-label={showPassword ? 'Hide password' : 'Show password'}
                            >
                              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                            </button>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setVal('keychain', !form.keychain)}
                          className={`mb-[18px] inline-flex items-center gap-1.5 text-[11px] transition-colors ${
                            form.keychain ? 'text-green-bright' : 'text-ink-faint hover:text-ink'
                          }`}
                        >
                          <ShieldIcon width={14} height={14} /> Enable keychain
                        </button>
                      </>
                    )}

                    <div className="mb-[18px]">
                      <label className={fieldLabel}>
                        Database <span className="text-ink-faint">(optional)</span>
                      </label>
                      <input
                        className={fieldInput}
                        type="text"
                        placeholder="Leave empty to select database after connecting"
                        value={form.database}
                        onChange={set('database')}
                      />
                    </div>
                  </>
                ) : (
                  <div className="mb-[18px]">
                    <label className={fieldLabel}>SSL Mode</label>
                    <Select
                      className={fieldInput}
                      value={form.sslmode || 'disable'}
                      onChange={(v) => setVal('sslmode', v)}
                      options={SSL_MODES.map((m) => ({ value: m, label: m }))}
                    />
                    <p className="mt-2 text-[11px] text-ink-faint">
                      Choose how the client negotiates SSL with the server. Use <span className="text-ink-dim">require</span>{' '}
                      or <span className="text-ink-dim">verify-full</span> for production databases.
                    </p>
                  </div>
                )}
              </>
            )}

            <div className={fieldRow}>
              <div className="mb-[18px]">
                <label className={fieldLabel}>Environment</label>
                <Select
                  className={fieldInput}
                  value={form.environment}
                  onChange={(v) => setVal('environment', v)}
                  options={ENVIRONMENTS.map((env) => ({
                    value: env,
                    label: env[0].toUpperCase() + env.slice(1),
                  }))}
                />
              </div>
              <div className="mb-[18px]">
                <label className={fieldLabel}>
                  Folder <span className="text-ink-faint">(optional)</span>
                </label>
                <input
                  className={fieldInput}
                  type="text"
                  placeholder="e.g. Demo"
                  value={form.folder}
                  onChange={set('folder')}
                />
              </div>
            </div>

            {test && test !== 'loading' && (
              <div
                className={`mt-1 mb-[18px] rounded-soft px-3.5 py-2.5 text-[11px] font-medium ${
                  test.ok
                    ? 'border border-green-dim bg-green/10 text-green-bright'
                    : 'border border-red/25 bg-red/10 text-[#ff9b9b]'
                }`}
              >
                {test.ok ? '✓ ' : '✕ '}
                {test.message}
              </div>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-3 border-t border-edge px-6 py-[18px]">
            <Button type="button" variant="ghost" size="lg" onClick={runTest} disabled={!valid || test === 'loading' || saving}>
              {test === 'loading' ? 'Testing…' : 'Test Connection'}
            </Button>
            <Button type="submit" variant="primary" size="lg" disabled={!valid || saving}>
              {saving ? 'Connecting…' : `${isEdit ? 'Update' : 'Create'} Connection`}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
