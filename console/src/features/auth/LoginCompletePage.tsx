import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { exchangeSignIn, useAuth } from '@/features/auth'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import AuthCard from './components/AuthCard'
import { Button } from '@/shared/ui/button'

// Where Google or GitHub sign-in lands: trades the one-time code for a session.
export default function LoginCompletePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { authenticate } = useAuth()
  const [error, setError] = useState('')
  // The code works once, and StrictMode runs effects twice in development.
  const used = useRef(false)

  useEffect(() => {
    if (used.current) return
    used.current = true
    exchangeSignIn(params.get('code') || '')
      .then(({ user, token }) => {
        authenticate(user, token)
        navigate('/', { replace: true })
      })
      .catch((err) => setError(err.message))
  }, [])

  return (
    <AuthCard>
      {error ? (
        <>
          <h2 className="text-[18px] font-bold">Couldn't sign you in</h2>
          <p className="mt-2 text-[12px] text-muted-foreground">{error}</p>
          <Button variant="default" size="lg" className="mt-5 w-full" onClick={() => navigate('/login', { replace: true })}>
            Back to sign in
          </Button>
        </>
      ) : (
        <LoadingState className="py-4 text-center" />
      )}
    </AuthCard>
  )
}
