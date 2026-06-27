import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Logo } from '../components/icons.jsx'
import { btnPrimary, fieldInput, fieldLabel } from '../ui.js'

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
      <div className="relative flex flex-col items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_40%,rgba(111,207,106,0.07),transparent_60%)] bg-bg max-[720px]:hidden">
        <div className="login-grid absolute inset-0" />
        <div className="relative z-[1] flex h-[130px] w-[130px] items-center justify-center rounded-[28px] bg-[linear-gradient(160deg,#1a1a1a,#080808)] shadow-[0_0_80px_-20px_rgba(111,207,106,0.22),inset_0_1px_0_rgba(255,255,255,0.04)]">
          <Logo width={70} height={70} />
        </div>
        <h1 className="z-[1] mt-9 text-[28px] font-bold tracking-[-0.5px]">Work With Your Databases</h1>
        <p className="z-[1] mt-2 font-serif text-xs italic text-ink-dim">Like A Pro</p>
      </div>

      <div className="flex items-center justify-center border-l border-edge bg-panel">
        <form className="w-full max-w-[380px] px-10" onSubmit={handleSubmit}>
          <h2 className="text-[23px] font-bold">Admin Sign In</h2>
          <p className="mt-2 mb-8 text-[11px] text-ink-dim">Sign in to manage your database connections.</p>

          {error && (
            <div className="mb-[18px] rounded-soft border border-red/25 bg-red/10 px-3.5 py-2.5 text-[11px] text-[#ff9b9b]">
              {error}
            </div>
          )}

          <div className="mb-[18px]">
            <label className={fieldLabel} htmlFor="username">Username</label>
            <input
              id="username"
              className={fieldInput}
              type="text"
              autoComplete="username"
              placeholder="admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="mb-[18px]">
            <label className={fieldLabel} htmlFor="password">Password</label>
            <input
              id="password"
              className={fieldInput}
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className={`${btnPrimary} w-full`} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>

          <p className="mt-[22px] text-center text-xs text-ink-faint">
            Demo credentials —{' '}
            <code className="rounded-[5px] bg-elevated px-1.5 py-0.5 text-green">admin</code> /{' '}
            <code className="rounded-[5px] bg-elevated px-1.5 py-0.5 text-green">admin123</code>
          </p>
        </form>
      </div>
    </div>
  )
}
