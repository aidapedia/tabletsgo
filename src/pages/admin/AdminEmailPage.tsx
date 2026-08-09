import { AdminSmtpPanel } from '@/features/admin'
import { Narrow, Section } from '@/pages/home/ui'

/**
 * `/admin/email` — the instance-wide mail server.
 *
 * The one instance-level setting that reaches into every workspace: it's what
 * sends invites, password resets and notifications for any workspace whose
 * owner hasn't configured their own SMTP. Previously env-only (SMTP_*), which
 * meant changing it took a redeploy.
 */
export default function AdminEmailPage() {
  return (
    <Section
      title="Email"
      desc="The mail server this instance sends from. Every workspace inherits it unless its owner configures one of their own."
    >
      {/* The page spans the same container as every other section; only the
          form column is capped, so the header still lines up with the rest. */}
      <Narrow>
        <AdminSmtpPanel />
      </Narrow>
    </Section>
  )
}
