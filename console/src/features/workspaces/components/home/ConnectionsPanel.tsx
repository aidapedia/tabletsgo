import { useNavigate } from 'react-router-dom'
import { ConnectHandshakeDialog, EnvBadge, TYPE_LABEL, useConnectHandshake } from '@/features/connections'
import { Button } from '@/shared/ui/button'
import { DbLogo } from '@/shared/ui/icons'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import HomePanel from './HomePanel'

const SHOWN = 6

// Production first: it is the one people most need to find fast, and the one
// whose badge should be in view without scrolling. Then by name.
const ENV_RANK: Record<string, number> = { production: 0, staging: 1, development: 2, local: 3 }
const byEnvThenName = (a: any, b: any) =>
  (ENV_RANK[a.environment] ?? 4) - (ENV_RANK[b.environment] ?? 4) || a.name.localeCompare(b.name)

/**
 * The workspace's databases as a launcher — the home page's main job is getting
 * someone into a console, so Connect is on every row, behind the same handshake
 * the Connection section uses. The row itself opens the connection's detail.
 */
export default function ConnectionsPanel({ connections, loading }: { connections: any[]; loading: boolean }) {
  const navigate = useNavigate()
  const { connect, connectingId, failure, dismiss, openAnyway } = useConnectHandshake()
  const rows = [...connections].sort(byEnvThenName).slice(0, SHOWN)

  return (
    <HomePanel
      title="Connections"
      desc={connections.length > SHOWN ? `${SHOWN} of ${connections.length}` : undefined}
      onViewAll={() => navigate('/connections')}
    >
      {loading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState>No connections yet.</EmptyState>
      ) : (
        <ul className="flex flex-col">
          {rows.map((c) => {
            const where = c.type === 'sqlite' ? (c.filepath || '').split('/').pop() : c.host
            return (
              <li key={c.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/connections/${c.id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/connections/${c.id}`)}
                  className="group flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <DbLogo type={c.type} className="size-8 shrink-0 rounded-[9px]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[12px] font-medium">{c.name}</span>
                      <EnvBadge environment={c.environment} dense />
                    </div>
                    <div className="truncate text-[11px] text-faint">
                      {TYPE_LABEL[c.type] || c.type}
                      {where && <span className="font-mono"> · {where}</span>}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={connectingId === c.id || c.locked}
                    title={c.locked ? `${TYPE_LABEL[c.type] || c.type} is turned off on this instance` : undefined}
                    onClick={(e) => {
                      e.stopPropagation()
                      connect(c)
                    }}
                    className="shrink-0"
                  >
                    {connectingId === c.id ? 'Connecting…' : 'Connect'}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {failure && (
        <ConnectHandshakeDialog
          conn={failure.conn}
          result={failure.result}
          busy={connectingId === failure.conn.id}
          onRetry={() => connect(failure.conn)}
          onEdit={() => {
            dismiss()
            navigate(`/connections/${failure.conn.id}/edit`)
          }}
          onOpenAnyway={() => openAnyway(failure.conn)}
          onClose={dismiss}
        />
      )}
    </HomePanel>
  )
}
