import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { forgotPassword } from '@/features/auth'
import { Logo } from '@/shared/ui/icons'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form/FormField'
import { Input } from '@/shared/ui/input'

// Request a password-reset link by email. Always shows the same confirmation
// (whether or not the email exists) so accounts can't be enumerated.
export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await forgotPassword(email.trim())
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_50%_30%,rgba(111,207,106,0.06),transparent_60%)] bg-background p-6">
      <div className="w-full max-w-[400px] rounded-[16px] border border-border bg-sidebar p-8">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <span className="text-[18px] font-bold tracking-[-0.3px]">
            Tabl<span className="text-primary">et</span>sgo
          </span>
        </div>

        {sent ? (
          <>
            <h2 className="text-[20px] font-bold">Check your email</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              If an account exists for <span className="text-foreground">{email.trim()}</span>, we've sent a link to reset your
              password. The link expires in 1 hour.
            </p>
            <Button variant="default" size="lg" className="mt-6 w-full" onClick={() => navigate('/login')}>
              Back to sign in
            </Button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <h2 className="text-[20px] font-bold">Reset your password</h2>
            <p className="mt-1.5 mb-6 text-[12px] text-muted-foreground">Enter your account email and we'll send you a reset link.</p>
            <FormField label="Email" className="!mb-6">
              <Input
                type="email"
                autoComplete="username"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </FormField>
            <Button type="submit" variant="default" size="lg" className="w-full" disabled={loading}>
              {loading ? 'Sending…' : 'Send reset link'}
            </Button>
            <Button variant="link" size="inline" type="button" className="text-muted-foreground hover:text-foreground w-full mt-4 !text-[11px]" onClick={() => navigate('/login')}>
              Back to sign in
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
