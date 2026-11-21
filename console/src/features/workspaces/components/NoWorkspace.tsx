import { useState } from 'react'
import { AuthCard, useAuth } from '@/features/auth'
import { Button } from '@/shared/ui/button'
import { useWorkspaces } from '../stores/WorkspaceContext'

/**
 * What someone signed in at Hayat sees when they belong to no workspace and
 * aren't an instance admin: drawn instead of the app, not inside it — every
 * page of the app works on a workspace, so there is nothing to show them yet.
 * A tenant's roster in Hayat is the only way in.
 */
export default function NoWorkspace() {
  const { user, accountUrl, logout } = useAuth()
  const { refresh } = useWorkspaces()
  const [checking, setChecking] = useState(false)
  const firstName = (user?.name || '').split(' ')[0] || 'there'

  const checkAgain = async () => {
    setChecking(true)
    try {
      await refresh()
    } finally {
      setChecking(false)
    }
  }

  return (
    <AuthCard>
      <h1 className="mb-1 text-[16px] font-semibold">Welcome, {firstName}</h1>
      <p className="mb-4 text-[13px] text-muted-foreground">
        You’re signed in, but you aren’t in a Tabletsgo workspace yet, so there’s nothing to open here.
      </p>
      <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-[10px] border border-border bg-background/50 p-3 text-[12px]">
        <dt className="text-muted-foreground">Signed in as</dt>
        <dd className="truncate">{user?.email}</dd>
      </dl>
      <p className="mb-5 text-[12px] text-muted-foreground">
        Ask a workspace owner to add you to their workspace in Hayat, then check again.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="lg" onClick={() => void logout()}>
          Sign out
        </Button>
        <Button size="lg" className="flex-1" onClick={() => void checkAgain()} disabled={checking}>
          {checking ? 'Checking…' : 'Check again'}
        </Button>
      </div>
      {accountUrl && (
        <a className="mt-4 block text-center text-[12px] text-primary-bright hover:underline" href={accountUrl} target="_blank" rel="noreferrer">
          Your Hayat account
        </a>
      )}
    </AuthCard>
  )
}
