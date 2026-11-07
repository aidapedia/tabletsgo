import { AdminSmtpPanel } from '@/features/admin'
import { Narrow, Section } from '@/pages/home/ui'

/**
 * `/admin/email` — the instance-wide mail server.
 *
 * The one instance-level setting that reaches into every workspace: it's what
 * sends invites, password resets and notifications for all of them, and no
 * workspace has a mail server of its own. Previously env-only (SMTP_*), which
 * meant changing it took a redeploy.
 */
export default function AdminEmailPage() {
  return (
    <Section
      title="Email"
      desc="The mail server this instance sends from. Every workspace uses it for invites, password resets and notifications."
    >
      {/* The page spans the same container as every other section; only the
          form column is capped, so the header still lines up with the rest. */}
      <Narrow>
        <AdminSmtpPanel />
      </Narrow>
    </Section>
  )
}
