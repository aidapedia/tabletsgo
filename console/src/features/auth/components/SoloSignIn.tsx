import { useState, type FormEvent } from 'react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { FormField } from '@/shared/ui/form/FormField'
import PasswordInput from '@/shared/ui/form/PasswordInput'
import AuthCard from './AuthCard'
import { useAuth } from '../stores/AuthContext'

/**
 * Solo mode's sign-in: the owner's email and password. Shown in place by
 * `RequireAuth`, so signing in leaves you on the page you asked for.
 */
export default function SoloSignIn() {
  const { soloSignIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await soloSignIn(email, password)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <AuthCard>
      <h1 className="mb-1 text-[16px] font-semibold">Sign in</h1>
      <p className="mb-5 text-[13px] text-muted-foreground">This instance runs in solo mode. Sign in as its owner.</p>
      <form onSubmit={submit} noValidate>
        <FormField label="Email" htmlFor="solo-email">
          <Input id="solo-email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        <FormField label="Password" htmlFor="solo-password" error={error}>
          <PasswordInput id="solo-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        <Button type="submit" size="lg" className="mt-1 w-full" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="mt-5 text-[11px] text-faint">
        Forgot it? On the server, run <code className="font-mono text-muted-foreground">npm run solo:reset-password</code> (in Docker:{' '}
        <code className="font-mono text-muted-foreground">docker compose exec tabletsgo npm run solo:reset-password</code>).
      </p>
    </AuthCard>
  )
}
