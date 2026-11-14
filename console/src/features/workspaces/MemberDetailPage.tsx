import { useNavigate, useParams } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { useWorkspaces } from './stores/WorkspaceContext'
import { useMember } from './hooks/useMember'
import MemberAccessTable from './components/MemberAccessTable'
import PageHeader from '@/shared/ui/page/PageHeader'
import PersonAvatar from '@/shared/ui/PersonAvatar'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'

/**
 * `/members/:userId` — one member and their Access list: everything Hayat says
 * reaches them in this workspace. Read-only like the roster; the header links to
 * the workspace in Hayat's console, where grants change.
 */
export default function MemberDetailPage() {
  const { userId } = useParams()
  const navigate = useNavigate()
  const { current } = useWorkspaces()
  const { member, loading } = useMember(current?.id, userId)

  if (loading) return <LoadingState className="py-20 text-center" />
  if (!member) {
    return (
      <EmptyState className="py-20">
        This person isn't a member of {current?.name || 'this workspace'}.{' '}
        <button className="text-primary hover:underline" onClick={() => navigate('/members')}>
          Back to members
        </button>
      </EmptyState>
    )
  }

  const name = member.name || member.email
  return (
    <div className="w-full">
      <PageHeader
        crumbs={[{ label: name }]}
        media={<PersonAvatar size="lg" seed={name} />}
        title={name}
        meta={member.isOwner ? <Badge variant="default">owner</Badge> : member.status !== 'active' ? <Badge variant="warning">{member.status}</Badge> : null}
        desc={member.email}
        action={
          current?.manageUrl && (
            <Button asChild variant="default" size="lg">
              <a href={current.manageUrl} target="_blank" rel="noreferrer">
                Manage in Hayat <ExternalLink />
              </a>
            </Button>
          )
        }
      />
      <div className="mt-6">
        <h2 className="text-[16px] font-bold tracking-[-0.2px]">Access</h2>
        <p className="mt-1 mb-4 text-[12px] text-muted-foreground">
          Every role that reaches {member.name || 'them'} in this workspace — granted directly, through a group, or to everyone — and what they own.
        </p>
        <MemberAccessTable access={member.access} />
      </div>
    </div>
  )
}
