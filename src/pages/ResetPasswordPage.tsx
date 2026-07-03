import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth, getReset, resetPassword } from '@/features/auth'
import { Logo } from '@/shared/ui/icons'
import Button from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Form, FormField } from '@/shared/ui/Form'

// Complete a password reset: validate the token, set a new password, then the
// user is signed in and sent to the homepage.
export default function ResetPasswordPage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { authenticate } = useAuth()
  const [info, setInfo] = useState<{ email: string } | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getReset(token)
      .then(setInfo)
      .catch(() => setInvalid(true))
  }, [token])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { user, token: session } = await resetPassword(token, password)
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
      <div className="w-full max-w-[400px] rounded-[16px] border border-edge bg-panel p-8 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]">
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
        <h2 className="text-[18px] font-bold">Link unavailable</h2>
        <p className="mt-2 text-[12px] text-ink-dim">This reset link is invalid or has expired. Request a new one.</p>
        <Button variant="primary" size="lg" className="mt-5 w-full" onClick={() => navigate('/forgot')}>
          Request a new link
        </Button>
      </>
    )
  }
  if (!info) return shell(<div className="py-4 text-center text-xs text-ink-faint">Loading…</div>)

  return shell(
    <Form onSubmit={handleSubmit}>
      <h2 className="text-[20px] font-bold">Set a new password</h2>
      <p className="mt-1.5 mb-6 text-[12px] text-ink-dim">
        For <span className="text-ink">{info.email}</span>. Choose a new password to finish.
      </p>

      {error && (
        <div className="mb-[18px] rounded-soft border border-red/25 bg-red/10 px-3.5 py-2.5 text-[11px] text-[#ff9b9b]">{error}</div>
      )}

      <FormField label="New password" className="mb-6">
        <Input
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
        />
      </FormField>

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>
        {loading ? 'Saving…' : 'Reset password'}
      </Button>
    </Form>
  )
}
