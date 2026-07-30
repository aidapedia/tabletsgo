import Badge from '@/shared/ui/Badge'

// Environment → badge tone, so "production" reads as a warning at a glance.
export const ENV_TONE: Record<string, 'red' | 'amber' | 'green' | 'neutral'> = {
  production: 'red',
  staging: 'amber',
  development: 'green',
  local: 'neutral',
}

// The connection's environment pill. Renders nothing when the connection has no
// environment set, so callers can drop it in without guarding.
export default function EnvBadge({
  environment,
  dense = false,
  className = '',
}: {
  environment?: string | null
  dense?: boolean
  className?: string
}) {
  if (!environment) return null
  return (
    <Badge tone={ENV_TONE[environment] || 'neutral'} dense={dense} className={className}>
      {environment}
    </Badge>
  )
}
