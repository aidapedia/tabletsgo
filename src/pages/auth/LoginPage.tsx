import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth'
import { Logo, TableIcon, CodeIcon, ShieldIcon, CheckIcon } from '@/shared/ui/icons'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import { Input } from '@/shared/ui/form/Input'
import { Form, FormField } from '@/shared/ui/form/Form'

const HIGHLIGHTS = [
  { icon: TableIcon, title: 'Browse & edit data', desc: 'Inspect tables and rows without leaving the app' },
  { icon: CodeIcon, title: 'Run queries fast', desc: 'A focused SQL editor with history and saved queries' },
  { icon: ShieldIcon, title: 'Encrypted at rest', desc: 'Credentials sealed with AES-256-GCM' },
]

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username.trim(), password)
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid h-full grid-cols-2 max-[720px]:grid-cols-1">
      <div className="relative flex flex-col justify-between overflow-hidden bg-bg px-14 py-12 max-[720px]:hidden">
        {/* layered backdrop */}
        <div className="login-grid absolute inset-0" />
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-green/15 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-32 -right-16 h-96 w-96 rounded-full bg-green/10 blur-[130px]" />

        {/* brand */}
        <div className="relative z-[1] flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[linear-gradient(160deg,#1a1a1a,#080808)] shadow-[0_0_40px_-12px_rgba(111,207,106,0.35),inset_0_1px_0_rgba(255,255,255,0.05)]">
            <Logo width={26} height={26} />
          </div>
          <span className="text-[15px] font-semibold tracking-[-0.3px]">Tabletsgo</span>
        </div>

        {/* headline + highlights */}
        <div className="relative z-[1] max-w-[420px]">
          <h1 className="text-[34px] font-bold leading-[1.15] tracking-[-0.8px]">
            One home for all your
            <span className="text-green"> databases</span>.
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-dim">
            Connect SQLite, PostgreSQL and more — browse, query and manage them from a single workspace.
          </p>

          <ul className="mt-9 flex flex-col gap-4">
            {HIGHLIGHTS.map(({ icon: Icon, title, desc }) => (
              <li key={title} className="flex items-start gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-soft border border-edge bg-panel text-green">
                  <Icon width={16} height={16} />
                </span>
                <div>
                  <div className="text-[13px] font-semibold leading-tight">{title}</div>
                  <div className="mt-0.5 text-[11.5px] leading-snug text-ink-faint">{desc}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* footer note */}
        <div className="relative z-[1] flex items-center gap-2 text-[11px] text-ink-faint">
          <CheckIcon width={13} height={13} className="text-green" />
          Your connection credentials never leave your server.
        </div>
      </div>

      <div className="flex items-center justify-center border-l border-edge bg-panel">
        <Form className="w-full max-w-[380px] px-10" onSubmit={handleSubmit}>
          <h2 className="text-[23px] font-bold">Sign In</h2>
          <p className="mt-2 mb-8 text-[11px] text-ink-dim">Sign in to manage your database connections.</p>

          {error && (
            <div className="mb-[18px] rounded-soft border border-red/25 bg-red/10 px-3.5 py-2.5 text-[11px] text-[#ff9b9b]">
              {error}
            </div>
          )}

          <FormField label="Email" htmlFor="username" className="mb-[18px]">
            <Input
              id="username"
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </FormField>

          <FormField label="Password" htmlFor="password" className="mb-[18px]">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </FormField>

          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </Button>

          <TextButton block className="mt-4 !text-[11px]" onClick={() => navigate('/forgot')}>
            Forgot password?
          </TextButton>
        </Form>
      </div>
    </div>
  )
}
