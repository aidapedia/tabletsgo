import type { ReactNode } from 'react'
import { Button } from '@/shared/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

/**
 * The frame every home-page block sits in: a title, an optional line under it,
 * and a "View all" into the section the block summarises. The body is the
 * caller's; a block shows a few rows, never the whole list.
 */
export default function HomePanel({
  title,
  desc,
  onViewAll,
  viewAllLabel = 'View all',
  children,
  className,
}: {
  title: ReactNode
  desc?: ReactNode
  onViewAll?: () => void
  viewAllLabel?: string
  children: ReactNode
  className?: string
}) {
  return (
    <Card size="sm" className={className}>
      <CardHeader>
        <CardTitle className="text-[13px] font-semibold">{title}</CardTitle>
        {desc && <CardDescription className="text-[11px]">{desc}</CardDescription>}
        {onViewAll && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={onViewAll} className="text-muted-foreground">
              {viewAllLabel}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="px-1.5">{children}</CardContent>
    </Card>
  )
}
