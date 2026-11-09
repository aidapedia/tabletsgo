import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth, getInvite, acceptInvite, getSignInOptions, OrDivider, ProviderButtons, signInErrorMessage, type SignInOptions } from '@/features/auth'
import { Logo } from '@/shared/ui/icons'
import PasswordInput from '@/shared/ui/form/PasswordInput'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form/FormField'
import { Input } from '@/shared/ui/input'

// Invite acceptance: the invited email sets their name + password, or signs in
// with Google or GitHub, then is logged in and dropped onto the homepage (their
// new workspace). A registration link lands here too, with no workspace to name.
export default function AcceptInvitePage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { authenticate } = useAuth()
  const [params] = useSearchParams()
  const [invite, setInvite] = useState<{ email: string; workspaceName: string | null } | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [form, setForm] = useState({ name: '', password: '' })
  const [error, setError] = useState(() => signInErrorMessage(params.get('error')))
  const [loading, setLoading] = useState(false)
  const [options, setOptions] = useState<SignInOptions | null>(null)

  useEffect(() => {
    getInvite(token)
      .then(setInvite)
      .catch(() => setInvalid(true))
    getSignInOptions().then(setOptions)
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
    <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_50%_30%,rgba(111,207,106,0.06),transparent_60%)] bg-background p-6">
      <div className="w-full max-w-[400px] rounded-[16px] border border-border bg-sidebar p-8">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <span className="text-[18px] font-bold tracking-[-0.3px]">
            Tabl<span className="text-primary">et</span>sgo
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
        <p className="mt-2 text-[12px] text-muted-foreground">This invite link is invalid or has expired. Ask an admin to send a new one.</p>
        <Button variant="default" size="lg" className="mt-5 w-full" onClick={() => navigate('/login')}>Go to sign in</Button>
      </>
    )
  }
  if (!invite) return shell(<LoadingState className="py-4 text-center" />)

  return shell(
    <form onSubmit={handleSubmit}>
      <h2 className="text-[20px] font-bold">{invite.workspaceName ? `Join ${invite.workspaceName}` : 'Finish your account'}</h2>
      <p className="mt-1.5 mb-6 text-[12px] text-muted-foreground">
        {invite.workspaceName ? 'You were invited as' : 'Your account is'} <span className="text-foreground">{invite.email}</span>. Set a password to finish.
      </p>

      {error && (
        <div className="mb-[18px] rounded-lg border border-destructive/25 bg-destructive/10 px-3.5 py-2.5 text-[11px] text-[#ff9b9b]">{error}</div>
      )}

      {!!options?.providers.length && (
        <>
          <ProviderButtons providers={options.providers} invite={token} onError={setError} />
          <OrDivider label="or set a password" />
        </>
      )}

      <FormField label="Your name">
        <Input type="text" placeholder="Jane Doe" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
      </FormField>
      <FormField label="Password" className="!mb-6">
        <PasswordInput autoComplete="new-password" placeholder="••••••••" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required />
      </FormField>

      <Button type="submit" variant="default" size="lg" className="w-full" disabled={loading}>
        {loading ? 'Joining…' : invite.workspaceName ? 'Join workspace' : 'Create account'}
      </Button>
    </form>
  )
}
