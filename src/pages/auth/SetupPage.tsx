import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, submitSetup } from '@/features/auth'
import { getAdminModules, ModulePicker, ModuleSettingsFields, draftOf, patchOf, updateModules, useModules } from '@/features/modules'
import type { AdminModule, ModulePatch, SettingsDraft } from '@/features/modules'
import { Logo } from '@/shared/ui/icons'
import Button from '@/shared/ui/buttons/Button'
import { Input } from '@/shared/ui/form/Input'
import PasswordInput from '@/shared/ui/form/PasswordInput'
import { Form, FormField } from '@/shared/ui/form/Form'

type Props = {
  /** The instance already has accounts — the wizard promotes one instead of creating one. */
  hasUsers?: boolean
  onComplete?: () => void
}

type Step = 'admin' | 'modules' | 'configure'

// The wizard runs until the instance has an administrator. It creates that
// account — no workspace: an admin holds no workspace access, so the first
// workspace is theirs to create, with a real owner, once they are signed in.
//
// Two shapes, because an instance with no admin isn't always an empty one:
//   - empty instance  → create the administrator, then choose which databases
//                       and features the instance offers and configure them
//                       (signed in as that admin, through Admin → Modules' API)
//   - has accounts    → prove control of one of them and promote it; its
//                       connections already decide which databases are in use,
//                       so it skips the module steps (the defaults stand)
export default function SetupPage({ hasUsers = false, onComplete }: Props) {
  const { authenticate } = useAuth()
  const { refresh } = useModules()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('admin')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [modules, setModules] = useState<AdminModule[]>([])
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [drafts, setDrafts] = useState<Record<string, SettingsDraft>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const finish = (to: string) => {
    onComplete?.()
    navigate(to)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { user, token } = await submitSetup({
        email: form.email.trim(),
        password: form.password,
        name: form.name.trim(),
      })
      authenticate(user, token)
      if (hasUsers) return finish('/')
      const list = await getAdminModules().catch(() => null)
      // Couldn't read them: the admin is made and the defaults stand — the same
      // as skipping, and Admin → Modules is where to change it.
      if (!list) return finish('/admin')
      setModules(list)
      setPicked(Object.fromEntries(list.map((m) => [m.id, m.enabled])))
      setDrafts(Object.fromEntries(list.map((m) => [m.id, draftOf(m.settings)])))
      setStep('modules')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const configurable = modules.filter((m) => picked[m.id] && m.settings.length)
  const enginesPicked = modules.filter((m) => m.kind === 'engine' && picked[m.id]).length

  const save = async ({ withSettings }: { withSettings: boolean }) => {
    setError('')
    setLoading(true)
    try {
      const patch: Record<string, ModulePatch> = {}
      for (const m of modules) {
        patch[m.id] = { enabled: !!picked[m.id] }
        if (withSettings && picked[m.id] && m.settings.length) patch[m.id].settings = patchOf(m.settings, drafts[m.id])
      }
      await updateModules(patch)
      await refresh()
      finish('/admin')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const steps: { id: Step; label: string }[] = [
    { id: 'admin', label: 'Admin account' },
    { id: 'modules', label: 'Choose modules' },
    ...(configurable.length || step === 'admin' ? [{ id: 'configure' as Step, label: 'Configure' }] : []),
  ]
  const at = steps.findIndex((s) => s.id === step)

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-[radial-gradient(circle_at_50%_30%,rgba(111,207,106,0.06),transparent_60%)] bg-bg p-6">
      <div className={`w-full rounded-[16px] border border-edge bg-panel p-8 ${step === 'admin' ? 'max-w-[420px]' : 'max-w-[680px]'}`}>
        <div className="mb-6 flex items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <span className="text-[18px] font-bold tracking-[-0.3px]">
            Tabl<span className="text-green">et</span>sgo
          </span>
          {!hasUsers && (
            <span className="ml-auto text-[11px] text-ink-faint">
              Step {at + 1} of {steps.length} · {steps[at].label}
            </span>
          )}
        </div>

        {error && (
          <div className="mb-[18px] rounded-soft border border-red/25 bg-red/10 px-3.5 py-2.5 text-[11px] text-[#ff9b9b]">
            {error}
          </div>
        )}

        {step === 'admin' && (
          <Form onSubmit={handleSubmit}>
            <h2 className="text-[20px] font-bold">{hasUsers ? 'This instance has no administrator' : "Welcome — let's get set up"}</h2>
            <p className="mt-1.5 mb-6 text-[12px] text-ink-dim">
              {hasUsers
                ? 'Sign in with an existing account to make it the instance administrator.'
                : 'Create the instance administrator. Next you’ll choose which databases and features this instance offers.'}
            </p>

            {!hasUsers && (
              <FormField label="Your name">
                <Input type="text" placeholder="Jane Doe" value={form.name} onChange={set('name')} autoFocus />
              </FormField>
            )}

            <FormField label={hasUsers ? 'Account email' : 'Admin email'}>
              <Input
                type="email"
                autoComplete="username"
                placeholder="admin@acme.com"
                value={form.email}
                onChange={set('email')}
                required
                autoFocus={hasUsers}
              />
            </FormField>

            <FormField label={hasUsers ? 'Current password' : 'Password'} className="!mb-6">
              <PasswordInput
                autoComplete={hasUsers ? 'current-password' : 'new-password'}
                placeholder="••••••••"
                value={form.password}
                onChange={set('password')}
                required
              />
            </FormField>

            {hasUsers && (
              <p className="-mt-3 mb-6 text-[11px] leading-snug text-ink-faint">
                An administrator holds no workspace access, so this account leaves every workspace it belongs to. You can put
                an owner back from the admin area afterwards.
              </p>
            )}

            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>
              {loading ? 'Working…' : hasUsers ? 'Make this account admin' : 'Create admin account'}
            </Button>
          </Form>
        )}

        {step === 'modules' && (
          <>
            <h2 className="text-[20px] font-bold">What will this instance manage?</h2>
            <p className="mt-1.5 mb-6 text-[12px] text-ink-dim">
              Workspaces only see what you turn on here. You can change this any time in Admin → Modules.
            </p>
            <ModulePicker modules={modules} selected={picked} onToggle={(id) => setPicked((p) => ({ ...p, [id]: !p[id] }))} />
            <div className="mt-7 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-ink-faint">{enginesPicked ? '' : 'Pick at least one database to continue.'}</span>
              <Button variant="subtle" size="lg" className="ml-auto" disabled={loading} onClick={() => finish('/admin')}>
                Skip — keep the defaults
              </Button>
              <Button
                variant="primary"
                size="lg"
                disabled={!enginesPicked || loading}
                onClick={() => (configurable.length ? setStep('configure') : save({ withSettings: false }))}
              >
                {loading ? 'Saving…' : configurable.length ? 'Continue' : 'Finish setup'}
              </Button>
            </div>
          </>
        )}

        {step === 'configure' && (
          <>
            <h2 className="text-[20px] font-bold">Configure</h2>
            <p className="mt-1.5 mb-6 text-[12px] text-ink-dim">
              Instance-wide settings for what you picked. The defaults are fine to start with.
            </p>
            <div className="flex flex-col gap-6">
              {configurable.map((m) => (
                <section key={m.id}>
                  <h3 className="mb-3 text-[13px] font-semibold">{m.label}</h3>
                  <ModuleSettingsFields
                    moduleId={m.id}
                    settings={m.settings}
                    draft={drafts[m.id]}
                    onChange={(k, v) => setDrafts((d) => ({ ...d, [m.id]: { ...d[m.id], [k]: v } }))}
                  />
                </section>
              ))}
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="lg" disabled={loading} onClick={() => setStep('modules')}>
                Back
              </Button>
              <Button variant="subtle" size="lg" className="ml-auto" disabled={loading} onClick={() => save({ withSettings: false })}>
                Skip — use defaults
              </Button>
              <Button variant="primary" size="lg" disabled={loading} onClick={() => save({ withSettings: true })}>
                {loading ? 'Saving…' : 'Finish setup'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
