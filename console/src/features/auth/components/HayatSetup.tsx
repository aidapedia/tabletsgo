import AuthCard from './AuthCard'
import HayatEnrollment from './HayatEnrollment'
import { useAuth } from '../stores/AuthContext'

/**
 * An enterprise instance that isn't enrolled with Hayat yet (or whose
 * credentials Hayat refuses): drawn in place of signing in, like solo's
 * first-run setup. Once enrolled, the button signs in at Hayat.
 */
export default function HayatSetup() {
  const { config, reloadConfig } = useAuth()
  const reason = config?.mode === 'enterprise' && config.setup ? config.setup.reason : 'new'
  return (
    <AuthCard>
      <HayatEnrollment consoleUrl={config?.consoleUrl ?? null} reason={reason} onDone={() => void reloadConfig()} />
    </AuthCard>
  )
}
