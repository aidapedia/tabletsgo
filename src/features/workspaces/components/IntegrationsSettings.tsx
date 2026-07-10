import { useWorkspaces } from '@/features/workspaces/stores/WorkspaceContext'
import SmtpSettings from './SmtpSettings'
import { StorageList } from '@/features/backup'

// Workspace → Integrations: external services the workspace connects to.
// SMTP (mail server for member invites) and S3 Storage (backup destinations)
// live together here rather than as separate top-level pages.
export default function IntegrationsSettings() {
  const { current } = useWorkspaces()
  if (!current) return <div className="text-xs text-ink-faint">Loading…</div>

  const isAdmin = current.role === 'admin'

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="mb-1 text-[14px] font-bold">SMTP</div>
        <p className="mb-3 text-[12px] text-ink-dim">Configure the mail server used to send member-invite emails.</p>
        {isAdmin ? (
          <SmtpSettings workspaceId={current.id} />
        ) : (
          <p className="text-[12px] text-ink-faint">Only workspace admins can change email settings.</p>
        )}
      </div>

      <div className="border-t border-edge pt-6">
        <div className="mb-1 text-[14px] font-bold">S3 Storage</div>
        <p className="mb-3 text-[12px] text-ink-dim">Storage destinations connections can back up to.</p>
        <StorageList workspaceId={current.id} />
      </div>
    </div>
  )
}
