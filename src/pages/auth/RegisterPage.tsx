import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { getSignInOptions, OrDivider, ProviderButtons, register, type SignInOptions } from '@/features/auth'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import { Input } from '@/shared/ui/form/Input'
import { Form, FormField } from '@/shared/ui/form/Form'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import AuthCard from './AuthCard'

// Create an account. The email route only asks for an address: the password is
// chosen from the emailed link, so nobody can claim an address that isn't theirs.
export default function RegisterPage() {
  const navigate = useNavigate()
  const [options, setOptions] = useState<SignInOptions | null>(null)
  const [form, setForm] = useState({ name: '', email: '' })
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getSignInOptions().then(setOptions)
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await register({ email: form.email.trim(), name: form.name.trim() || undefined })
      setSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!options) return <AuthCard><LoadingState className="py-4 text-center" /></AuthCard>
  if (!options.registration.open) return <Navigate to="/login" replace />

  if (sent) {
    return (
      <AuthCard>
        <h2 className="text-[18px] font-bold">Check your email</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">
          If <span className="text-ink">{form.email.trim()}</span> can be registered, we've sent it a link to finish creating your account. The link
          expires in 7 days.
        </p>
        <Button variant="primary" size="lg" className="mt-5 w-full" onClick={() => navigate('/login')}>
          Back to sign in
        </Button>
      </AuthCard>
    )
  }

  const { providers, registration } = options

  return (
    <AuthCard>
      <h2 className="text-[20px] font-bold">Create your account</h2>
      <p className="mt-1.5 mb-6 text-[12px] leading-relaxed text-ink-dim">
        You'll get access to a workspace when one of its owners adds you.
      </p>

      {error && <div className="mb-[18px] rounded-soft border border-red/25 bg-red/10 px-3.5 py-2.5 text-[11px] text-[#ff9b9b]">{error}</div>}

      {providers.length > 0 && <ProviderButtons providers={providers} onError={setError} />}
      {providers.length > 0 && registration.email && <OrDivider label="or with email" />}

      {registration.email && (
        <Form onSubmit={submit}>
          <FormField label="Your name">
            <Input type="text" autoComplete="name" placeholder="Jane Doe" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </FormField>
          <FormField label="Email" className="!mb-6">
            <Input
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </FormField>
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>
            {loading ? 'Sending…' : 'Continue'}
          </Button>
        </Form>
      )}

      {!providers.length && !registration.email && (
        <p className="text-[12px] leading-relaxed text-ink-dim">Sign-up isn't available yet. Ask an administrator to set up email or a sign-in provider.</p>
      )}

      <TextButton block className="mt-4 !text-[11px]" onClick={() => navigate('/login')}>
        Already have an account? Sign in
      </TextButton>
    </AuthCard>
  )
}
