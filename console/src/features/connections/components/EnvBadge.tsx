import { Badge } from '@/shared/ui/badge'

// Environment → badge tone, so "production" reads as a warning at a glance.
export const ENV_TONE: Record<string, 'destructive' | 'warning' | 'default' | 'secondary'> = {
  production: 'destructive',
  staging: 'warning',
  development: 'default',
  local: 'secondary',
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
    <Badge variant={ENV_TONE[environment] || 'secondary'} size={dense ? 'dense' : 'default'} className={className}>
      {environment}
    </Badge>
  )
}
