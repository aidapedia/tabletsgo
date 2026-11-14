import { useState, type FormEvent } from 'react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { FormField } from '@/shared/ui/form/FormField'
import PasswordInput from '@/shared/ui/form/PasswordInput'
import AuthCard from './AuthCard'
import { useAuth } from '../stores/AuthContext'

const MIN_PASSWORD = 8

/**
 * A new solo instance's first run: the setup code from the server's log, then
 * the owner's name, email and password. The code is what keeps someone who can
 * reach the port, but can't read the log, from claiming the instance.
 */
export default function SoloSetup() {
  const { soloSetup } = useAuth()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const short = password.length > 0 && password.length < MIN_PASSWORD

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null
      await soloSetup({ code, name, email, password, timezone })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <AuthCard>
      <h1 className="mb-1 text-[16px] font-semibold">Set up Tabletsgo</h1>
      <p className="mb-5 text-[13px] text-muted-foreground">
        You’ll be this instance’s owner. Copy the setup code from the server’s log: <code className="font-mono">docker logs tabletsgo</code>.
      </p>
      <form onSubmit={submit} noValidate>
        <FormField label="Setup code" htmlFor="setup-code">
          <Input
            id="setup-code"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="amber-falcon-river-stone-maple-orbit"
            className="font-mono"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </FormField>
        <FormField label="Your name" htmlFor="setup-name">
          <Input id="setup-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Email" htmlFor="setup-email" hint="You sign in with it. It also becomes your Hayat account if you move to enterprise later.">
          <Input id="setup-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        <FormField
          label="Password"
          htmlFor="setup-password"
          hint={short ? undefined : `At least ${MIN_PASSWORD} characters.`}
          error={short ? `At least ${MIN_PASSWORD} characters.` : error}
        >
          <PasswordInput id="setup-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        <Button type="submit" size="lg" className="mt-1 w-full" disabled={busy || !code || !email || password.length < MIN_PASSWORD}>
          {busy ? 'Setting up…' : 'Create owner and sign in'}
        </Button>
      </form>
    </AuthCard>
  )
}
