import Button from '@/shared/ui/buttons/Button'

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
    <div className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]">
      <div className="w-full max-w-[400px] animate-pop rounded-[16px] border border-edge-strong bg-panel p-5">
        <div className="flex items-center gap-2.5">
          {reconnecting && (
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-green/30 border-t-green" />
          )}
          <h3 className="text-sm font-bold text-ink">{reconnecting ? 'Reconnecting…' : 'Connection lost'}</h3>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">
          {reconnecting
            ? `Trying to reach ${name || 'the database'}…`
            : `Couldn't connect to ${name || 'the database'}. ${error}`}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="subtle" size="sm" disabled={reconnecting} onClick={onLeave}>
            Back to home
          </Button>
          <Button variant="primary" size="sm" disabled={reconnecting} onClick={onReconnect}>
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
      </div>
    </div>
  )
}
