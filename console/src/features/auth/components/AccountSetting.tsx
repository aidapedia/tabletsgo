import { ExternalLink } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import PersonAvatar from '@/shared/ui/PersonAvatar'
import { useAuth } from '../stores/AuthContext'

/**
 * Your account, read-only: it lives in Hayat, shared by every application that
 * signs in there. Name, password, time zone and sign-in methods change in
 * Hayat's account page; this shows what tabletsgo sees and links there.
 */
export default function AccountSetting() {
  const { user, accountUrl } = useAuth()
  if (!user) return null
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-[12px] border border-border p-4">
        <PersonAvatar seed={user.name || user.email} className="!h-10 !w-10" />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{user.name || user.email}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </div>
      </div>
      <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-[13px]">
        <dt className="text-muted-foreground">Time zone</dt>
        <dd>{user.timezone || 'Your browser’s'}</dd>
        <dt className="text-muted-foreground">Instance role</dt>
        <dd>{user.role === 'admin' ? 'Tabletsgo admin' : 'Member'}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">
        Your name, password, time zone and sign-in methods are managed in your Hayat account, and apply to every app you sign in to with it.
      </p>
      {accountUrl ? (
        <Button asChild variant="outline" size="sm">
          <a href={accountUrl} target="_blank" rel="noreferrer">
            Manage your account <ExternalLink />
          </a>
        </Button>
      ) : (
        <p className="text-xs text-faint">Ask your administrator for the address of the Hayat console.</p>
      )}
    </div>
  )
}
