import { Link } from 'react-router-dom'
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
  const s3Enabled = !!current.experiments?.s3Backup

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
        <div className="mb-1 flex items-center gap-2 text-[14px] font-bold">
          S3 Storage
          <span className="rounded-[6px] border border-edge bg-elevated px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-faint">
            Beta
          </span>
        </div>
        <p className="mb-3 text-[12px] text-ink-dim">Storage destinations connections can back up to.</p>
        {s3Enabled ? (
          <StorageList workspaceId={current.id} />
        ) : (
          <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-edge-strong py-14 text-center">
            <h3 className="text-[13px] font-semibold text-ink">This is a beta experiment</h3>
            <p className="mt-1.5 max-w-[320px] text-[12px] leading-relaxed text-ink-dim">
              {isAdmin ? (
                <>
                  Turn it on in the{' '}
                  <Link to="/workspace/beta" className="text-green-bright underline-offset-2 hover:underline">
                    Beta
                  </Link>{' '}
                  tab to use it.
                </>
              ) : (
                'Ask a workspace admin to enable it in the Beta tab.'
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
