import { useWorkspaces } from '@/features/workspaces/stores/WorkspaceContext'
import SmtpSettings from './SmtpSettings'

// Workspace → Integrations: external services the workspace connects to
// (currently just SMTP, the mail server for member invites).
export default function IntegrationsSettings() {
  const { current } = useWorkspaces()
  if (!current) return <div className="text-xs text-ink-faint">Loading…</div>

  const isAdmin = current.role === 'admin'

  return (
    <div>
      <div className="mb-1 text-[14px] font-bold">SMTP</div>
      <p className="mb-3 text-[12px] text-ink-dim">Configure the mail server used to send member-invite emails.</p>
      {isAdmin ? (
        <SmtpSettings workspaceId={current.id} />
      ) : (
        <p className="text-[12px] text-ink-faint">Only workspace admins can change email settings.</p>
      )}
    </div>
  )
}
