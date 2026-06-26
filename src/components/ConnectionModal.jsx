import { useState } from 'react'
import { useConnections } from '../context/ConnectionsContext.jsx'
import { CloseIcon } from './icons.jsx'
import { btnGhost, btnPrimary, connIcon, fieldInput, fieldLabel } from '../ui.js'

const DB_TYPES = [
  { id: 'sqlite', label: 'SQLite', abbr: 'SQ', defaultPort: '' },
  { id: 'postgresql', label: 'PostgreSQL', abbr: 'PG', defaultPort: '5432' },
]

const ENVIRONMENTS = ['development', 'staging', 'production', 'local']

const blankSqlite = {
  name: '',
  type: 'sqlite',
  environment: 'local',
  filepath: '',
  folder: '',
}

const blankPostgres = {
  name: '',
  type: 'postgresql',
  environment: 'development',
  host: '',
  port: '5432',
  username: 'postgres',
  password: '',
  database: '',
  folder: '',
}

const fieldRow = 'grid grid-cols-[2fr_1fr] gap-3.5 max-[720px]:grid-cols-1'

export default function ConnectionModal({ initial, onClose, onSave }) {
  const { testConnection } = useConnections()
  const isEdit = !!initial
  const isSqlite = initial?.type === 'sqlite'

  const [form, setForm] = useState(() => {
    if (initial) return initial
    return blankSqlite
  })
  const [test, setTest] = useState(null) // { ok, message } | 'loading'

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
    setTest(null)
  }

  const pickType = (t) => {
    const blank = t.id === 'sqlite' ? { ...blankSqlite } : { ...blankPostgres }
    setForm((f) => ({ ...f, type: t.id, port: t.defaultPort, ...blank }))
    setTest(null)
  }

  const valid =
    form.name.trim() &&
    (isSqlite
      ? form.filepath.trim()
      : form.host.trim() && form.port.trim() && form.database.trim())

  const runTest = async () => {
    if (!valid) return
    setTest('loading')
    const result = await testConnection(form)
    setTest(result)
  }

  const handleSave = (e) => {
    e.preventDefault()
    if (!valid) return
    onSave({
      ...form,
      name: form.name.trim(),
      host: form.host?.trim() || '',
      port: form.port?.trim() || '',
      filepath: form.filepath?.trim() || '',
      folder: form.folder.trim(),
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[4px]"
      onMouseDown={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-[520px] animate-pop overflow-y-auto rounded-[18px] border border-edge-strong bg-panel shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSave}>
          <div className="flex items-center justify-between border-b border-edge px-6 py-[22px]">
            <h3 className="text-base font-bold">{isEdit ? 'Edit Connection' : 'New Connection'}</h3>
            <button
              type="button"
              className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-ink-dim hover:bg-elevated hover:text-ink"
              onClick={onClose}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="p-6">
            <div className="mb-[22px] grid grid-cols-2 gap-3">
              {DB_TYPES.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => pickType(t)}
                  className={`flex items-center gap-3 rounded-soft border p-3.5 transition-all ${
                    form.type === t.id
                      ? 'border-green bg-card-hover shadow-[0_0_0_3px_rgba(116,196,118,0.22)]'
                      : 'border-edge bg-elevated hover:border-edge-strong'
                  }`}
                >
                  <div className={connIcon(t.id, 'h-[38px] w-[38px] text-[11px] font-extrabold')}>{t.abbr}</div>
                  <span className="text-[11px] font-semibold">{t.label}</span>
                </button>
              ))}
            </div>

            <div className="mb-[18px]">
              <label className={fieldLabel}>Connection Name</label>
              <input
                className={fieldInput}
                type="text"
                placeholder={isSqlite ? 'e.g. Demo DB' : 'e.g. Production DB'}
                value={form.name}
                onChange={set('name')}
                required
              />
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

                <div className={fieldRow}>
                  <div className="mb-[18px]">
                    <label className={fieldLabel}>Username</label>
                    <input
                      className={fieldInput}
                      type="text"
                      placeholder="postgres"
                      value={form.username}
                      onChange={set('username')}
                    />
                  </div>
                  <div className="mb-[18px]">
                    <label className={fieldLabel}>Password</label>
                    <input
                      className={fieldInput}
                      type="password"
                      placeholder="••••••"
                      value={form.password}
                      onChange={set('password')}
                    />
                  </div>
                </div>

                <div className="mb-[18px]">
                  <label className={fieldLabel}>Database Name</label>
                  <input
                    className={fieldInput}
                    type="text"
                    placeholder="postgres"
                    value={form.database}
                    onChange={set('database')}
                    required
                  />
                </div>
              </>
            )}

            <div className={fieldRow}>
              <div className="mb-[18px]">
                <label className={fieldLabel}>Environment</label>
                <select className={fieldInput} value={form.environment} onChange={set('environment')}>
                  {ENVIRONMENTS.map((env) => (
                    <option key={env} value={env}>
                      {env[0].toUpperCase() + env.slice(1)}
                    </option>
                  ))}
                </select>
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

          <div className="flex justify-end gap-3 border-t border-edge px-6 py-[18px]">
            <button
              type="button"
              className={btnGhost}
              onClick={runTest}
              disabled={!valid || test === 'loading'}
            >
              {test === 'loading' ? 'Testing…' : 'Test Connection'}
            </button>
            <button type="submit" className={btnPrimary} disabled={!valid}>
              {isEdit ? 'Update' : 'Create'} Connection
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
