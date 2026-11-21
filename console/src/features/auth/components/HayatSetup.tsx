import { useNavigate } from 'react-router-dom'
import AuthCard from './AuthCard'
import HayatEnrollment from './HayatEnrollment'
import { useAuth } from '../stores/AuthContext'

/**
 * An enterprise instance that isn't enrolled with Hayat yet (or whose
 * credentials Hayat refuses): drawn in place of signing in, like solo's
 * first-run setup. Once enrolled, the button signs in at Hayat — and, on a new
 * instance, comes back to the admin area: there is no workspace yet, and the
 * admin's next stops (Modules, Email) are there. Someone who isn't the admin
 * is sent on from it as usual.
 */
export default function HayatSetup() {
  const { config, reloadConfig } = useAuth()
  const navigate = useNavigate()
  const reason = config?.mode === 'enterprise' && config.setup ? config.setup.reason : 'new'
  const done = async () => {
    await reloadConfig()
    // Signing in returns to the address shown, so move there before it starts
    // (it waits on reading the token store). Moving first would remount this
    // page at the new address and flash its first step.
    if (reason === 'new') navigate('/admin', { replace: true })
  }
  return (
    <AuthCard>
      <HayatEnrollment consoleUrl={config?.consoleUrl ?? null} reason={reason} onDone={() => void done()} />
    </AuthCard>
  )
}
