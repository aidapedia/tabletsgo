import { useState } from 'react'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { useToast } from '@/shared/ui/feedback/Toast'
import Button from '@/shared/ui/buttons/Button'
import Checkbox from '@/shared/ui/form/Checkbox'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import Segmented from '@/shared/ui/form/Segmented'
import Select from '@/shared/ui/form/Select'
import { Input, controlClass } from '@/shared/ui/form/Input'
import PasswordInput from '@/shared/ui/form/PasswordInput'
import { Label } from '@/shared/ui/form/Form'
import { createSshGateway, testSshGateway, updateSshGateway } from '../lib/api'
import { PROVIDERS, RAILWAY_SSH_HOST, providerOf, transportOf, type SshProvider } from '../lib/providers'
import type { SshGateway, SshKey, SshTestResult } from '../types'

const AUTH_MODES = [
  { value: 'key', label: 'SSH key' },
  { value: 'password', label: 'Password' },
]

const fieldRow = 'grid grid-cols-[2fr_1fr] gap-3.5 max-[720px]:grid-cols-1'

// What each preset tells the person filling it in. The fields themselves are
// the same record; a preset only relabels them and hides what doesn't apply.
const GUIDE: Record<SshProvider, string> = {
  generic: 'Any SSH server this app can reach directly — a bastion or jump host in front of your private network.',
  railway:
    'Railway accepts SSH at ssh.railway.com, logging you in to one service\'s container. Register the key\'s public key with Railway (railway ssh keys add, or your account\'s SSH keys). On the connection, 127.0.0.1 is that container — log in as the database service itself and use 127.0.0.1:5432, or as another service and use the database\'s private name (postgres.railway.internal:5432).',
  cloudflare:
    'An SSH server behind a Cloudflare Tunnel, protected by a Cloudflare Access application. Create a service token (Zero Trust → Access → Service Auth) and add a "Service Auth" policy to the application that includes it.',
}

// Create/edit slide-over for an SSH host ("gateway" in the API). Testing needs
// the stored credentials, so — as with storage destinations — it saves an
// existing host first and only exists on edit.
export default function SshGatewayModal({
  workspaceId,
  initial,
  keys,
  onClose,
  onSaved,
}: {
  workspaceId: string
  initial?: SshGateway | null
  keys: SshKey[]
  onClose: () => void
  onSaved: (g: SshGateway) => void
}) {
  const toast = useToast()
  const { show, close } = useSlideOver(onClose)
  const isEdit = !!initial
  // The stored host as last saved — a test can pin its host key, which the
  // `initial` prop would never show.
  const [current, setCurrent] = useState(initial || null)
  const [provider, setProvider] = useState<SshProvider>(() => (initial ? providerOf(initial) : 'generic'))
  const [form, setForm] = useState(() => ({
    name: initial?.name || '',
    host: initial?.host || '',
    port: String(initial?.port || 22),
    username: initial?.username || '',
    auth: initial?.auth || 'key',
    keyId: initial?.keyId || keys[0]?.id || '',
    password: '',
    serviceTokenId: initial?.serviceTokenId || '',
    serviceTokenSecret: '',
    resetHostKey: false,
  }))
  const [saving, setSaving] = useState(false)
  const [test, setTest] = useState<SshTestResult | 'loading' | null>(null)

  const set = (key: string, value: any) => {
    setForm((f) => ({ ...f, [key]: value }))
    setTest(null)
  }

  // Switching preset fills in what it implies and clears what it owned.
  const pickProvider = (next: SshProvider) => {
    setProvider(next)
    setTest(null)
    setForm((f) => {
      const wasRailway = f.host.trim().toLowerCase() === RAILWAY_SSH_HOST
      if (next === 'railway') return { ...f, host: RAILWAY_SSH_HOST, port: '22', auth: 'key' }
      return { ...f, host: wasRailway ? '' : f.host }
    })
  }

  const cloudflare = provider === 'cloudflare'
  const railway = provider === 'railway'
  // A stored secret may stay blank (it is kept); a new one must be given.
  const tokenOk = !form.serviceTokenId.trim() || !!form.serviceTokenSecret || (!!current?.hasServiceToken && form.serviceTokenId === current.serviceTokenId)
  const valid =
    form.name.trim() &&
    form.host.trim() &&
    form.username.trim() &&
    (cloudflare || form.port.trim()) &&
    (form.auth === 'key' ? !!form.keyId : !!form.password || !!current?.hasPassword) &&
    (!cloudflare || tokenOk)

  const payload = () => ({
    name: form.name.trim(),
    host: form.host.trim(),
    port: form.port,
    username: form.username.trim(),
    auth: form.auth as 'key' | 'password',
    keyId: form.auth === 'key' ? form.keyId : null,
    password: form.password || undefined,
    transport: transportOf(provider),
    ...(cloudflare ? { serviceTokenId: form.serviceTokenId.trim(), serviceTokenSecret: form.serviceTokenSecret || undefined } : {}),
    resetHostKey: form.resetHostKey,
  })

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    try {
      const saved = isEdit ? await updateSshGateway(initial!.id, payload()) : await createSshGateway({ workspaceId, ...payload() })
      toast.success(`Saved "${saved.name}".`)
      close(() => onSaved(saved))
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const runTest = async () => {
    if (!valid || !isEdit) return
    setTest('loading')
    try {
      const saved = await updateSshGateway(initial!.id, payload())
      setForm((f) => ({ ...f, password: '', serviceTokenSecret: '', resetHostKey: false }))
      const result = await testSshGateway(initial!.id)
      const refreshed = { ...saved, hostFingerprint: result.hostFingerprint ?? saved.hostFingerprint }
      setCurrent(refreshed)
      onSaved(refreshed)
      setTest(result)
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    } catch (err: any) {
      setTest({ ok: false, message: err.message })
      toast.error(err.message)
    }
  }

  return (
    <SlideOverPanel
      show={show}
      close={close}
      width={500}
      onSubmit={handleSave}
      title={isEdit ? 'Edit SSH Host' : 'New SSH Host'}
      footer={
        <>
          {isEdit && (
            <Button type="button" variant="ghost" size="lg" onClick={runTest} disabled={!valid || test === 'loading' || saving}>
              {test === 'loading' ? 'Testing…' : 'Test'}
            </Button>
          )}
          <Button type="submit" variant="primary" size="lg" disabled={!valid || saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Host'}
          </Button>
        </>
      }
    >
      <div className="mb-[18px]">
        <Segmented value={provider} onChange={pickProvider} options={PROVIDERS} />
        <p className="mt-2.5 text-[11px] leading-relaxed text-ink-faint">{GUIDE[provider]}</p>
      </div>

      <div className="mb-[18px]">
        <Label>Name</Label>
        <Input
          placeholder={railway ? 'e.g. Railway — api service' : cloudflare ? 'e.g. Office bastion (Cloudflare)' : 'e.g. Production bastion'}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          required
        />
      </div>

      {cloudflare ? (
        <div className="mb-[18px]">
          <Label>Access hostname</Label>
          <Input placeholder="ssh.example.com" value={form.host} onChange={(e) => set('host', e.target.value)} required />
          <p className="mt-2 text-[11px] text-ink-faint">The public hostname of the Access application that routes to the SSH server.</p>
        </div>
      ) : (
        <div className={fieldRow}>
          <div className="mb-[18px]">
            <Label>Host</Label>
            <Input placeholder="bastion.example.com" value={form.host} onChange={(e) => set('host', e.target.value)} required />
          </div>
          <div className="mb-[18px]">
            <Label>Port</Label>
            <Input placeholder="22" value={form.port} onChange={(e) => set('port', e.target.value)} required />
          </div>
        </div>
      )}

      {cloudflare && (
        <>
          <div className="mb-[18px]">
            <Label>
              Service token ID <span className="text-ink-faint">(Cf-Access-Client-Id)</span>
            </Label>
            <Input
              className="font-mono"
              placeholder="xxxxxxxx.access"
              value={form.serviceTokenId}
              onChange={(e) => set('serviceTokenId', e.target.value)}
            />
          </div>
          <div className="mb-[18px]">
            <Label>
              Service token secret <span className="text-ink-faint">(Cf-Access-Client-Secret)</span>
            </Label>
            <PasswordInput
              className="font-mono"
              placeholder={current?.hasServiceToken && form.serviceTokenId === current.serviceTokenId ? 'Unchanged' : ''}
              value={form.serviceTokenSecret}
              onChange={(e) => set('serviceTokenSecret', e.target.value)}
            />
          </div>
        </>
      )}

      <div className="mb-[18px]">
        <Label>{railway ? 'Service domain or instance ID' : 'User'}</Label>
        <Input
          placeholder={railway ? 'myapp.up.railway.app or a service instance ID' : 'ubuntu'}
          value={form.username}
          onChange={(e) => set('username', e.target.value)}
          required
        />
        {railway && (
          <p className={`mt-2 text-[11px] ${/\.railway\.internal$/i.test(form.username.trim()) ? 'text-[#ff9b9b]' : 'text-ink-faint'}`}>
            Not the private <span className="text-ink-dim">.railway.internal</span> name — Railway doesn't recognise it and opens
            its interactive menu instead. A service with no public domain (a database) uses its instance ID: open the service,
            press ⌘K / Ctrl+K, choose <span className="text-ink-dim">Copy Service Instance ID</span> — not the Service ID,
            which looks the same but is refused.
          </p>
        )}
      </div>

      {/* Railway logs in with registered keys only. */}
      {!railway && (
        <div className="mb-[18px]">
          <Label>Authentication</Label>
          <Select className={controlClass} value={form.auth} onChange={(v) => set('auth', v)} options={AUTH_MODES} />
        </div>
      )}

      {form.auth === 'key' ? (
        <div className="mb-[18px]">
          <Label>Key</Label>
          {keys.length ? (
            <Select
              className={controlClass}
              value={form.keyId}
              onChange={(v) => set('keyId', v)}
              options={keys.map((k) => ({ value: k.id, label: k.name, hint: k.fingerprint }))}
            />
          ) : (
            <p className="text-[11px] text-ink-faint">This workspace has no SSH keys yet — add one under SSH → Key first.</p>
          )}
        </div>
      ) : (
        <div className="mb-[18px]">
          <Label>Password</Label>
          <PasswordInput
            placeholder={current?.hasPassword ? 'Unchanged' : ''}
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
          />
        </div>
      )}

      {isEdit && (
        <div className="mb-[18px]">
          <Label>Host key</Label>
          {current?.hostFingerprint ? (
            <>
              <p className="break-all font-mono text-[11px] text-ink-dim">{current.hostFingerprint}</p>
              <label className="mt-2.5 flex cursor-pointer items-center gap-2.5">
                <Checkbox checked={form.resetHostKey} onChange={(v) => set('resetHostKey', v)} ariaLabel="Forget the pinned host key" />
                <span className="text-[12px] text-ink-dim">
                  Forget it <span className="text-ink-faint">(only if the host was rebuilt — the next login pins the new one)</span>
                </span>
              </label>
            </>
          ) : (
            <p className="text-[11px] text-ink-faint">Not pinned yet — it is recorded the first time the app logs in, and checked every time after.</p>
          )}
        </div>
      )}

      {test && test !== 'loading' && (
        <div
          className={`mt-1 mb-[18px] rounded-soft px-3.5 py-2.5 text-[11px] font-medium ${
            test.ok ? 'border border-green-dim bg-green/10 text-green-bright' : 'border border-red/25 bg-red/10 text-[#ff9b9b]'
          }`}
        >
          {test.ok ? '✓ ' : '✕ '}
          {test.message}
          {!test.ok && test.hint && <div className="mt-1.5 font-normal opacity-80">{test.hint}</div>}
        </div>
      )}
    </SlideOverPanel>
  )
}
