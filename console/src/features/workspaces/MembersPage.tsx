import { ExternalLink } from 'lucide-react'
import { useWorkspaces, MembersPanel } from '@/features/workspaces'
import { Section } from '@/shared/ui/page/Section'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { Button } from '@/shared/ui/button'

// Member section — who belongs to the workspace. The roster is the Hayat
// tenant's, so it is read here and changed in Hayat's console: inviting,
// removing and granting roles all happen there. `/workspace/member` redirects
// here so old links still land.
export default function MembersPage() {
  const { current } = useWorkspaces()

  return (
    <Section
      title="Member"
      desc="Who belongs to this workspace. People and their roles are managed in Hayat."
      action={
        current?.manageUrl && (
          <Button asChild variant="default" size="lg">
            <a href={current.manageUrl} target="_blank" rel="noreferrer">
              Manage in Hayat <ExternalLink />
            </a>
          </Button>
        )
      }
    >
      {current ? <MembersPanel workspaceId={current.id} /> : <LoadingState className="" />}
    </Section>
  )
}
