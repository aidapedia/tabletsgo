import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, submitSetup } from '@/features/auth'
import { Logo } from '@/shared/ui/icons'
import Button from '@/shared/ui/buttons/Button'
import { Input } from '@/shared/ui/form/Input'
import { Form, FormField } from '@/shared/ui/form/Form'

// First-run wizard: create the admin account and the first workspace. Shown
// (before the login page) only while no users exist — see RequireSetup.
export default function SetupPage() {
  const { authenticate } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '', workspace: '' })
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
        workspace: form.workspace.trim(),
      })
      authenticate(user, token)
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_50%_30%,rgba(111,207,106,0.06),transparent_60%)] bg-bg p-6">
      <Form className="w-full max-w-[420px] rounded-[16px] border border-edge bg-panel p-8 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]" onSubmit={handleSubmit}>
        <div className="mb-6 flex items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <span className="text-[18px] font-bold tracking-[-0.3px]">
            Tabl<span className="text-green">et</span>sgo
          </span>
        </div>

        <h2 className="text-[20px] font-bold">Welcome — let's get set up</h2>
        <p className="mt-1.5 mb-6 text-[12px] text-ink-dim">Create your admin account and your first workspace.</p>

        {error && (
          <div className="mb-[18px] rounded-soft border border-red/25 bg-red/10 px-3.5 py-2.5 text-[11px] text-[#ff9b9b]">
            {error}
          </div>
        )}

        <FormField label="Workspace name" className="mb-[18px]">
          <Input type="text" placeholder="Acme Inc." value={form.workspace} onChange={set('workspace')} required autoFocus />
        </FormField>

        <div className="mb-[18px] grid grid-cols-2 gap-3">
          <FormField label="Your name">
            <Input type="text" placeholder="Jane Doe" value={form.name} onChange={set('name')} />
          </FormField>
          <FormField label="Admin email">
            <Input type="email" autoComplete="username" placeholder="admin@acme.com" value={form.email} onChange={set('email')} required />
          </FormField>
        </div>

        <FormField label="Password" className="mb-6">
          <Input type="password" autoComplete="new-password" placeholder="••••••••" value={form.password} onChange={set('password')} required />
        </FormField>

        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>
          {loading ? 'Creating…' : 'Create workspace'}
        </Button>
      </Form>
    </div>
  )
}
