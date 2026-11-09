import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'

/**
 * The database went away — mid-session or on open. Blocking on purpose: every
 * view behind it is showing data that is no longer backed by anything, so the
 * only two useful moves are retry and leave.
 */
export default function ConnectionLostModal({
  name,
  error,
  reconnecting,
  onReconnect,
  onLeave,
}: {
  name?: string
  error: string
  reconnecting: boolean
  onReconnect: () => void
  onLeave: () => void
}) {
  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} className="block sm:max-w-[400px] p-5 gap-0">
        <div className="flex items-center gap-2.5">
          {reconnecting && (
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          )}
          <DialogTitle className="text-sm font-bold text-foreground">{reconnecting ? 'Reconnecting…' : 'Connection lost'}</DialogTitle>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          {reconnecting
            ? `Trying to reach ${name || 'the database'}…`
            : `Couldn't connect to ${name || 'the database'}. ${error}`}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={reconnecting} onClick={onLeave}>
            Back to home
          </Button>
          <Button variant="default" size="sm" disabled={reconnecting} onClick={onReconnect}>
            {reconnecting ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Reconnecting
              </>
            ) : (
              'Reconnect'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
