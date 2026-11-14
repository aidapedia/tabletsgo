import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/shared/ui/button'
import { PageLoading } from '@/shared/ui/feedback/LoadingState'
import AuthCard from './components/AuthCard'
import { useAuth } from './stores/AuthContext'

/** Where Hayat sends the browser back after signing in: finish the exchange, then go on. */
export default function CallbackPage() {
  const { config, completeSignIn, signIn } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    // The code is single-use: StrictMode's second effect run must not spend it again.
    if (!config || started.current) return
    started.current = true
    completeSignIn()
      .then((to) => navigate(to, { replace: true }))
      .catch((e: Error) => setError(e.message || 'Signing in failed.'))
  }, [config, completeSignIn, navigate])

  if (!error) return <PageLoading screen />
  return (
    <AuthCard>
      <h1 className="mb-2 text-[16px] font-semibold">Signing in didn’t finish</h1>
      <p className="mb-5 text-[13px] text-muted-foreground">{error}</p>
      <Button size="lg" className="w-full" onClick={() => signIn('/')}>
        Try again
      </Button>
    </AuthCard>
  )
}
