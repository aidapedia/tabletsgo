import { AdminSignInPanel } from '@/features/admin'
import { Narrow, Section } from '@/pages/home/ui'

/** `/admin/sign-in` — the Google and GitHub apps people can sign in through. */
export default function AdminSignInPage() {
  return (
    <Section title="Authentication" desc="Let people sign in with an account they already have. Each person's Google or GitHub account links to their account here.">
      <Narrow>
        <AdminSignInPanel />
      </Narrow>
    </Section>
  )
}
