import { supportsBackup } from '@/shared/config/databaseTypes'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useConnections } from '../stores/ConnectionsContext'
import { BackupConfigForm } from '@/features/backup'
import { useModules } from '@/features/modules'
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
import { controlClass, Input, Textarea } from '@/shared/ui/form/Input'
import PasswordInput from '@/shared/ui/form/PasswordInput'
import { FormField } from '@/shared/ui/form/Form'

const DB_TYPES = [
  { id: 'sqlite', label: 'SQLite', desc: 'A database file on this server', defaultPort: '' },
  { id: 'postgresql', label: 'PostgreSQL', desc: 'Relational, over the network', defaultPort: '5432' },
  { id: 'mysql', label: 'MySQL', desc: 'Relational, over the network', defaultPort: '3306' },
  { id: 'redis', label: 'Redis', desc: 'Key-value, over the network', defaultPort: '6379' },
  { id: 'kafka', label: 'Kafka', desc: 'Event streaming, over the network', defaultPort: '9092' },
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
// Kafka's login: none, or SASL. Every mechanism keeps its identity in
// username/password — a client ID/secret for OAUTHBEARER, an access key for
// AWS_MSK_IAM — so `SASL_LOGIN` only renames the two fields.
const KAFKA_AUTH_MODES = [
  { value: 'none', label: 'No authentication' },
  { value: 'password', label: 'SASL' },
]
const SASL_MECHANISMS = [
  { value: 'scram-sha-512', label: 'SCRAM-SHA-512' },
  { value: 'scram-sha-256', label: 'SCRAM-SHA-256' },
  { value: 'plain', label: 'PLAIN' },
  { value: 'oauthbearer', label: 'OAUTHBEARER (OAuth 2.0 client credentials)' },
  { value: 'aws_msk_iam', label: 'AWS_MSK_IAM (Amazon MSK IAM)' },
]
// The HTTP services beside a cluster; each is `<id>Url` / `<id>Username` /
// `<id>Password` on the record (server/db/kafka-rest.js).
const KAFKA_SERVICES = [
  { id: 'schemaRegistry', label: 'Schema Registry', placeholder: 'http://schema-registry:8081', help: 'Decodes Avro, Protobuf and JSON Schema messages, and lets you browse and register schemas. Confluent Cloud: the API key and secret go in user/password.' },
  { id: 'connect', label: 'Kafka Connect', placeholder: 'http://connect:8083', help: 'Manage connectors and their tasks.' },
  { id: 'ksql', label: 'ksqlDB', placeholder: 'http://ksqldb:8088', help: 'Run KSQL statements and browse streams, tables and queries.' },
]
const SASL_LOGIN = {
  oauthbearer: { user: 'Client ID', password: 'Client secret', placeholder: 'kafka-client' },
  aws_msk_iam: { user: 'Access key ID', password: 'Secret access key', placeholder: 'AKIA…' },
}
// A client certificate for brokers that require mTLS. JKS isn't readable here —
// convert it with `keytool -importkeystore -deststoretype PKCS12`.
const CLIENT_CERT_FORMATS = [
  { value: '', label: 'None' },
  { value: 'pem', label: 'PEM certificate + key' },
  { value: 'pkcs12', label: 'PKCS#12 file (.p12 / .pfx)' },
]
const SSL_MODES = ['disable', 'allow', 'prefer', 'require', 'verify-full']
// The driver either encrypts or doesn't: MySQL has no negotiating middle here.
const MYSQL_SSL_MODES = ['disable', 'require', 'verify-full']
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

// MySQL's record is Postgres's: same fields, same `sslmode`, so again nothing
// downstream needs to know.
const blankMysql = { ...blankPostgres, type: 'mysql', port: '3306', username: 'root' }

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

// Kafka reuses host/port (the first broker — what the SSH tunnel and the
// handshake name), username/password (SASL) and `tls` (Redis's switch). The
// bootstrap list itself has no counterpart, so it is its own field, `brokers`.
const blankKafka = {
  name: '',
  type: 'kafka',
  environment: 'development',
  brokers: '',
  host: '',
  port: '9092',
  auth: 'none',
  saslMechanism: 'scram-sha-512',
  username: '',
  password: '',
  tls: '',
  caCert: '',
  clientCertFormat: '',
  clientCert: '',
  clientKey: '',
  clientPfx: '',
  clientKeyPassphrase: '',
  oauthTokenUrl: '',
  oauthScope: '',
  oauthExtensions: '',
  awsRegion: '',
  awsSessionToken: '',
  schemaRegistryUrl: '',
  schemaRegistryUsername: '',
  schemaRegistryPassword: '',
  connectUrl: '',
  connectUsername: '',
  connectPassword: '',
  ksqlUrl: '',
  ksqlUsername: '',
  ksqlPassword: '',
  clientId: '',
  keychain: false,
  sshGatewayId: '',
  folder: '',
  tags: [],
}

const blankFor = (type) =>
  type === 'postgresql' ? blankPostgres : type === 'mysql' ? blankMysql : type === 'redis' ? blankRedis : type === 'kafka' ? blankKafka : blankSqlite

// The bootstrap list as typed (commas, spaces or newlines; an optional
// kafka:// prefix) → "host:port,host:port".
function normalizeBrokers(text) {
  return String(text || '')
    .split(/[\s,]+/)
    .map((b) => b.trim().replace(/^[a-z+]+:\/\//i, '').replace(/\/+$/, ''))
    .filter(Boolean)
    .map((b) => (/:\d+$/.test(b) ? b : `${b}:9092`))
    .join(',')
}

// A row of fields owns the gap below it — FormField drops its own margin inside
// a grid (see `.form-field` in index.css).
const fieldRow = 'mb-4 grid grid-cols-[2fr_1fr] gap-3.5 max-[720px]:grid-cols-1'

// The URI scheme each network engine's form accepts, and its default port.
const URI_SCHEMES = {
  postgresql: { protocol: /^postgres(ql)?:$/, port: '5432' },
  mysql: { protocol: /^mysql2?:$/, port: '3306' },
  redis: { protocol: /^rediss?:$/, port: '6379' },
}

// Parse a postgres://, mysql:// or redis:// URI into structured fields. Returns null if it
// doesn't parse (or isn't the URI scheme for `type`).
function parseUri(uri, type) {
  try {
    const u = new URL(uri)
    const scheme = URI_SCHEMES[type]
    if (!scheme?.protocol.test(u.protocol)) return null
    const isRedis = type === 'redis'
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
      port: u.port || scheme.port,
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
// The engine is chosen once, in the type picker before this form: everything
// filed under a connection (dashboards, workflows, schema history) is written for
// it, so the form only shows it locked — create and edit alike — and the server
// refuses a change.
//
// `onClose` is where cancelling lands (the record being edited, or the list for
// a new one).
export default function ConnectionForm({ initial, initialType, tab = 'general', onTab, onClose, onSave }) {
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
  const [saving, setSaving] = useState<false | 'save' | 'connect'>(false)

  const isSqlite = form.type === 'sqlite'
  const isRedis = form.type === 'redis'
  const isKafka = form.type === 'kafka'
  const isMysql = form.type === 'mysql'
  const mechanism = isKafka && (form.auth || 'password') === 'password' ? form.saslMechanism || 'scram-sha-512' : null
  const login = SASL_LOGIN[mechanism] || null
  const viaSsh = !isSqlite && via === 'ssh'

  // The gateways a network connection may tunnel through — this workspace's.
  const { current } = useWorkspaces()
  const workspaceId = initial?.workspaceId || current?.id
  const [gateways, setGateways] = useState<SshGateway[]>([])
  useEffect(() => {
    if (workspaceId) listSshGateways(workspaceId).then(setGateways)
  }, [workspaceId])
  // Only the dump-based engines can be backed up; Redis has no SQL export. And
  // only while the Backup module is on.
  const { isEnabled } = useModules()
  const backupSupported = isEdit && isEnabled('backup') && supportsBackup(form.type)
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
      : isKafka
        ? normalizeBrokers(form.brokers) && (!viaSsh || form.sshGatewayId)
        : form.port.trim() && (viaSsh ? form.sshGatewayId : form.host.trim()))

  // Kafka's host/port mirror the first bootstrap broker.
  const withFirstBroker = (f) => {
    if (f.type !== 'kafka') return f
    const brokers = normalizeBrokers(f.brokers)
    const first = brokers.split(',')[0] || ''
    const at = first.lastIndexOf(':')
    return { ...f, brokers, host: at > 0 ? first.slice(0, at) : first, port: at > 0 ? first.slice(at + 1) : '9092' }
  }

  const runTest = async () => {
    if (!valid) return
    setTest('loading')
    const result = await testConnection(withFirstBroker(form))
    setTest(result)
    if (result?.ok) toast.success(result.message || 'Connection successful!')
    else toast.error(result?.message || 'Connection failed')
  }

  // `connect` (create only) also opens the console once saved. A plain save of a
  // new connection skips the probe, so one can be stored while its database is
  // unreachable (VPN down, server not up yet); editing always probes first.
  const handleSave = async ({ connect = false } = {}) => {
    if (!valid || saving) return
    const payload = {
      ...withFirstBroker(form),
      name: form.name.trim(),
      // Spell out the tunnel's default so the detail view and lists show where
      // it actually goes.
      host: withFirstBroker(form).host?.trim() || (viaSsh ? '127.0.0.1' : ''),
      port: withFirstBroker(form).port?.trim() || '',
      filepath: form.filepath?.trim() || '',
      database: form.database?.trim() || '',
      folder: form.folder.trim(),
    }
    if (!isEdit && !connect) {
      setSaving('save')
      await onSave(payload, { connect: false })
      setSaving(false)
      return
    }
    // Verify the connection works before saving so we never store a broken one.
    setSaving('connect')
    const result = await testConnection(payload)
    setSaving(false)
    if (!result?.ok) {
      setTest(result || { ok: false, message: 'Connection test failed' })
      toast.error(result?.message || 'Connection failed')
      return
    }
    setTest(result)
    toast.success(`Connected — saving "${payload.name}".`)
    onSave(payload, { connect })
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
            : 'Chosen in the previous step and fixed from here on — go back to Connections to pick a different one.'
        }
      >
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
              isKafka ? (
                'Where the cluster is reached first.'
              ) : viaSsh ? (
                <>
                  Dialed <span className="text-ink-dim">from the SSH host</span>. Leave the host empty when the database runs on the
                  SSH host itself; otherwise use the address it sees (a private IP or internal hostname).
                </>
              ) : (
                'Paste a URI to fill the fields, or enter them yourself.'
              )
            }
          >
            {isKafka ? (
              <>
                <FormField
                  label="Bootstrap servers"
                  hint={
                    viaSsh
                      ? 'As the SSH host sees them. Every broker the cluster advertises is tunneled through the same SSH login.'
                      : 'host:port, separated by commas. The client discovers every other broker from these.'
                  }
                >
                  <Textarea
                    className="min-h-[64px] font-mono"
                    placeholder="b-1.kafka.internal:9092, b-2.kafka.internal:9092"
                    value={form.brokers || ''}
                    onChange={set('brokers')}
                  />
                </FormField>
                <FormField
                  label={
                    <>
                      Client ID <span className="text-ink-faint">(optional)</span>
                    </>
                  }
                  hint="Shown in broker logs and quotas. Defaults to tabletsgo."
                >
                  <Input className="font-mono" placeholder="tabletsgo" value={form.clientId || ''} onChange={set('clientId')} />
                </FormField>
              </>
            ) : (
              <>
                <FormField label="Connection URI">
                  <Input
                    className="font-mono"
                    type="text"
                    placeholder={isRedis ? 'redis://user:password@host:6379/0' : isMysql ? 'mysql://user:password@host:3306/database' : 'postgresql://user:password@host:5432/database'}
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
                    <Input type="text" placeholder={isRedis ? '6379' : isMysql ? '3306' : '5432'} value={form.port} onChange={set('port')} required />
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
              </>
            )}
          </FormSection>

          <FormSection title="Authentication">
            <FormField label="Method">
              <Select
                className={controlClass}
                value={form.auth || 'password'}
                onChange={(v) => setVal('auth', v)}
                options={isKafka ? KAFKA_AUTH_MODES : AUTH_MODES}
              />
            </FormField>

            {mechanism && (
              <FormField label="SASL mechanism" hint="Managed clusters (MSK, Confluent Cloud, Aiven, Event Hubs) authenticate over TLS — turn TLS on below.">
                <Select className={controlClass} value={mechanism} onChange={(v) => setVal('saslMechanism', v)} options={SASL_MECHANISMS} />
              </FormField>
            )}

            {mechanism === 'oauthbearer' && (
              <>
                <FormField label="Token endpoint" hint="Your identity provider's OAuth 2.0 token URL — a token is fetched with the client-credentials grant and reused until it expires.">
                  <Input type="url" placeholder="https://login.example.com/oauth2/token" value={form.oauthTokenUrl || ''} onChange={set('oauthTokenUrl')} required />
                </FormField>
                <div className={fieldRow}>
                  <FormField
                    label={
                      <>
                        Scope <span className="text-ink-faint">(optional)</span>
                      </>
                    }
                  >
                    <Input type="text" placeholder="kafka" value={form.oauthScope || ''} onChange={set('oauthScope')} />
                  </FormField>
                  <FormField
                    label={
                      <>
                        Extensions <span className="text-ink-faint">(optional)</span>
                      </>
                    }
                    help="SASL extensions as key=value, one per line or comma-separated. Confluent Cloud needs logicalCluster=lkc-… and identityPoolId=pool-…."
                  >
                    <Input type="text" placeholder="logicalCluster=lkc-abc12" value={form.oauthExtensions || ''} onChange={set('oauthExtensions')} />
                  </FormField>
                </div>
              </>
            )}

            {(form.auth || 'password') === 'password' && (
              <>
                <FormField
                  label={
                    login ? (
                      login.user
                    ) : (
                      <>
                        User{isRedis && <span className="text-ink-faint"> (ACL — leave empty for a password-only server)</span>}
                      </>
                    )
                  }
                >
                  <Input
                    type="text"
                    placeholder={login ? login.placeholder : isRedis ? 'default' : isKafka ? 'svc-tabletsgo' : isMysql ? 'root' : 'postgres'}
                    value={form.username}
                    onChange={set('username')}
                  />
                </FormField>

                <FormField label={login ? login.password : 'Password'} className={mechanism === 'aws_msk_iam' ? '' : '!mb-2'}>
                  <PasswordInput placeholder="••••••••" value={form.password} onChange={set('password')} />
                </FormField>

                {mechanism === 'aws_msk_iam' && (
                  <div className={fieldRow}>
                    <FormField
                      label={
                        <>
                          Session token <span className="text-ink-faint">(optional)</span>
                        </>
                      }
                      help="Only for temporary credentials (an assumed role or SSO session) — they expire, so update them here when they do."
                    >
                      <PasswordInput placeholder="••••••••" value={form.awsSessionToken || ''} onChange={set('awsSessionToken')} />
                    </FormField>
                    <FormField
                      label={
                        <>
                          Region <span className="text-ink-faint">(optional)</span>
                        </>
                      }
                      help="Read from the broker address (…kafka.eu-west-1.amazonaws.com) when left empty."
                    >
                      <Input type="text" placeholder="eu-west-1" value={form.awsRegion || ''} onChange={set('awsRegion')} />
                    </FormField>
                  </div>
                )}

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
            {isKafka ? (
              <>
                <FormField
                  label="TLS"
                  hint="On for an SSL or SASL_SSL listener (every managed Kafka), off for PLAINTEXT. Only skip verification for a self-signed certificate you trust."
                >
                  <Select className={controlClass} value={form.tls || ''} onChange={(v) => setVal('tls', v)} options={TLS_MODES} />
                </FormField>
                {form.tls && (
                  <FormField
                    label={
                      <>
                        CA certificate <span className="text-ink-faint">(optional, PEM)</span>
                      </>
                    }
                    hint="For brokers signed by a private CA."
                  >
                    <Textarea
                      className="min-h-[72px] font-mono"
                      placeholder="-----BEGIN CERTIFICATE-----"
                      value={form.caCert || ''}
                      onChange={set('caCert')}
                    />
                  </FormField>
                )}
                {form.tls && <ClientCertFields form={form} set={set} setVal={setVal} />}
              </>
            ) : isRedis ? (
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
                  options={(isMysql ? MYSQL_SSL_MODES : SSL_MODES).map((m) => ({ value: m, label: m }))}
                />
              </FormField>
            )}
          </FormSection>

          {isKafka && (
            <FormSection
              title="Ecosystem services"
              desc="Optional. Each one named here gets its own entry in the console's icon rail. They are reached the same way as the brokers (SSH tunnel included) and trust the CA certificate above."
            >
              {KAFKA_SERVICES.map((svc) => (
                <ServiceFields key={svc.id} svc={svc} form={form} set={set} />
              ))}
            </FormSection>
          )}
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
        <Button type="button" variant="ghost" size="lg" onClick={runTest} disabled={!valid || test === 'loading' || !!saving}>
          {test === 'loading' ? 'Testing…' : 'Test Connection'}
        </Button>
        {isEdit ? (
          <Button type="button" variant="primary" size="lg" onClick={() => handleSave()} disabled={!valid || !!saving}>
            {saving ? 'Connecting…' : 'Update Connection'}
          </Button>
        ) : (
          <>
            <Button type="button" variant="ghost" size="lg" onClick={() => handleSave()} disabled={!valid || !!saving}>
              {saving === 'save' ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={() => handleSave({ connect: true })}
              disabled={!valid || !!saving}
            >
              {saving === 'connect' ? 'Connecting…' : 'Connect'}
            </Button>
          </>
        )}
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
          // Editing sits under the connection it edits; a new one has no record
          // to sit under yet, so the trail is one level shorter.
          ...(isEdit ? [{ label: initial.name, onClick: onClose }] : []),
          { label: isEdit ? 'Edit' : 'New connection' },
        ]}
        title={isEdit ? 'Edit connection' : 'New connection'}
        desc={
          isEdit
            ? 'Update how Tabletsgo reaches this database.'
            : 'Point Tabletsgo at a database. Connect tests it, saves it and opens it; Save just stores it.'
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

// The client certificate a broker that requires mTLS checks: PEM text, or a
// PKCS#12 bundle read from a file and kept as base64.
function ClientCertFields({ form, set, setVal }) {
  const toast = useToast()
  const format = form.clientCertFormat || ''
  const loadPfx = (file?: File) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setVal('clientPfx', String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => toast.error('Could not read that file.')
    reader.readAsDataURL(file)
  }
  return (
    <>
      <FormField
        label="Client certificate"
        help="For brokers that require mutual TLS (ssl.client.auth=required). A Java keystore (JKS) converts to PKCS#12 with: keytool -importkeystore -srckeystore client.jks -destkeystore client.p12 -deststoretype PKCS12"
      >
        <Select className={controlClass} value={format} onChange={(v) => setVal('clientCertFormat', v)} options={CLIENT_CERT_FORMATS} />
      </FormField>
      {format === 'pem' && (
        <>
          <FormField label="Certificate (PEM)">
            <Textarea className="min-h-[72px] font-mono" placeholder="-----BEGIN CERTIFICATE-----" value={form.clientCert || ''} onChange={set('clientCert')} />
          </FormField>
          <FormField label="Private key (PEM)">
            <Textarea className="min-h-[72px] font-mono" placeholder="-----BEGIN PRIVATE KEY-----" value={form.clientKey || ''} onChange={set('clientKey')} />
          </FormField>
        </>
      )}
      {format === 'pkcs12' && (
        <FormField label="Keystore file" hint={form.clientPfx ? `Loaded · ${Math.round((form.clientPfx.length * 3) / 4 / 1024) || 1} KB — choose another file to replace it.` : undefined}>
          <Input type="file" accept=".p12,.pfx,application/x-pkcs12" onChange={(e) => loadPfx(e.target.files?.[0])} />
        </FormField>
      )}
      {format && (
        <FormField
          label={
            <>
              {format === 'pkcs12' ? 'Keystore password' : 'Key passphrase'} <span className="text-ink-faint">(optional)</span>
            </>
          }
        >
          <PasswordInput placeholder="••••••••" value={form.clientKeyPassphrase || ''} onChange={set('clientKeyPassphrase')} />
        </FormField>
      )}
    </>
  )
}

// One ecosystem service: its URL, and Basic-auth credentials once there is one.
function ServiceFields({ svc, form, set }) {
  const url = form[`${svc.id}Url`] || ''
  return (
    <>
      <FormField
        label={
          <>
            {svc.label} URL <span className="text-ink-faint">(optional)</span>
          </>
        }
        help={svc.help}
      >
        <Input type="url" placeholder={svc.placeholder} value={url} onChange={set(`${svc.id}Url`)} />
      </FormField>
      {url.trim() && (
        <div className={fieldRow}>
          <FormField
            label={
              <>
                {svc.label} user <span className="text-ink-faint">(optional)</span>
              </>
            }
          >
            <Input type="text" value={form[`${svc.id}Username`] || ''} onChange={set(`${svc.id}Username`)} />
          </FormField>
          <FormField label="Password">
            <PasswordInput placeholder="••••••••" value={form[`${svc.id}Password`] || ''} onChange={set(`${svc.id}Password`)} />
          </FormField>
        </div>
      )}
    </>
  )
}
