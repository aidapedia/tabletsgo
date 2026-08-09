import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, submitSetup } from '@/features/auth'
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

// The wizard runs until the instance has an administrator, and it creates only
// that account — no workspace. An admin holds no workspace access, so the first
// workspace is theirs to create, with a real owner, once they are signed in.
//
// Two shapes, because an instance with no admin isn't always an empty one:
//   - empty instance  → create the administrator account
//   - has accounts    → prove control of one of them and promote it
export default function SetupPage({ hasUsers = false, onComplete }: Props) {
  const { authenticate } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

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
      onComplete?.()
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_50%_30%,rgba(111,207,106,0.06),transparent_60%)] bg-bg p-6">
      <Form className="w-full max-w-[420px] rounded-[16px] border border-edge bg-panel p-8" onSubmit={handleSubmit}>
        <div className="mb-6 flex items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <span className="text-[18px] font-bold tracking-[-0.3px]">
            Tabl<span className="text-green">et</span>sgo
          </span>
        </div>

        <h2 className="text-[20px] font-bold">{hasUsers ? 'This instance has no administrator' : "Welcome — let's get set up"}</h2>
        <p className="mt-1.5 mb-6 text-[12px] text-ink-dim">
          {hasUsers
            ? 'Sign in with an existing account to make it the instance administrator.'
            : 'Create the instance administrator. Workspaces come after you sign in.'}
        </p>

        {error && (
          <div className="mb-[18px] rounded-soft border border-red/25 bg-red/10 px-3.5 py-2.5 text-[11px] text-[#ff9b9b]">
            {error}
          </div>
        )}

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
    </div>
  )
}
