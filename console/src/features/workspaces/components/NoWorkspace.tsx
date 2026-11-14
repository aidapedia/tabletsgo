import { useAuth } from '@/features/auth'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import PageHeader from '@/shared/ui/page/PageHeader'

// What a workspace page shows to someone who belongs to no workspace: a Hayat
// tenant's roster is the only way in, so there is nothing to do here but ask.
export default function NoWorkspace({ title }: { title?: string }) {
  const { user } = useAuth()
  const firstName = (user?.name || '').split(' ')[0] || 'there'
  return (
    <div className="w-full">
      <PageHeader title={title ?? `Welcome, ${firstName}`} desc="You're not in a workspace yet." />
      <EmptyState bordered className="mt-6 py-16">
        Ask a workspace owner to add {user?.email} to a workspace in Hayat, then refresh this page.
      </EmptyState>
    </div>
  )
}
