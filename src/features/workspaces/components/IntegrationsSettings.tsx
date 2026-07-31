import { useWorkspaces } from '@/features/workspaces/stores/WorkspaceContext'
import SmtpSettings from './SmtpSettings'
import LoadingState from '@/shared/ui/feedback/LoadingState'

// Workspace → Integrations: external services the workspace connects to
// (currently just SMTP, the mail server for member invites).
export default function IntegrationsSettings() {
  const { current } = useWorkspaces()
  if (!current) return <LoadingState className="" />

  const isOwner = current.role === 'owner'

  return isOwner ? (
    <SmtpSettings workspaceId={current.id} />
  ) : (
    <p className="text-[12px] text-ink-faint">Only workspace admins can change email settings.</p>
  )
}
