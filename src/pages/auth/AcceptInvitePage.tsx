import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth, getInvite, acceptInvite } from '@/features/auth'
import { Logo } from '@/shared/ui/icons'
import Button from '@/shared/ui/buttons/Button'
import { Input } from '@/shared/ui/form/Input'
import { Form, FormField } from '@/shared/ui/form/Form'
import LoadingState from '@/shared/ui/feedback/LoadingState'

// Invite acceptance: the invited email sets their name + password, then is
// logged in and dropped onto the homepage (their new workspace).
export default function AcceptInvitePage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { authenticate } = useAuth()
  const [invite, setInvite] = useState<{ email: string; workspaceName: string } | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [form, setForm] = useState({ name: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getInvite(token)
      .then(setInvite)
      .catch(() => setInvalid(true))
  }, [token])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { user, token: session } = await acceptInvite(token, { name: form.name.trim(), password: form.password })
      authenticate(user, session)
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const shell = (children) => (
    <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_50%_30%,rgba(111,207,106,0.06),transparent_60%)] bg-bg p-6">
      <div className="w-full max-w-[400px] rounded-[16px] border border-edge bg-panel p-8">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <span className="text-[18px] font-bold tracking-[-0.3px]">
            Tabl<span className="text-green">et</span>sgo
          </span>
        </div>
        {children}
      </div>
    </div>
  )

  if (invalid) {
    return shell(
      <>
        <h2 className="text-[18px] font-bold">Invite unavailable</h2>
        <p className="mt-2 text-[12px] text-ink-dim">This invite link is invalid or has expired. Ask an admin to send a new one.</p>
        <Button variant="primary" size="lg" className="mt-5 w-full" onClick={() => navigate('/login')}>Go to sign in</Button>
      </>
    )
  }
  if (!invite) return shell(<LoadingState className="py-4 text-center" />)

  return shell(
    <Form onSubmit={handleSubmit}>
      <h2 className="text-[20px] font-bold">Join {invite.workspaceName}</h2>
      <p className="mt-1.5 mb-6 text-[12px] text-ink-dim">
        You were invited as <span className="text-ink">{invite.email}</span>. Set a password to finish.
      </p>

      {error && (
        <div className="mb-[18px] rounded-soft border border-red/25 bg-red/10 px-3.5 py-2.5 text-[11px] text-[#ff9b9b]">{error}</div>
      )}

      <FormField label="Your name" className="mb-[18px]">
        <Input type="text" placeholder="Jane Doe" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
      </FormField>
      <FormField label="Password" className="mb-6">
        <Input type="password" autoComplete="new-password" placeholder="••••••••" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required />
      </FormField>

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>
        {loading ? 'Joining…' : 'Join workspace'}
      </Button>
    </Form>
  )
}
