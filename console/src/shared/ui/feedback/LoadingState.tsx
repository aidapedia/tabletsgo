import { Loader2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

// The standard faint "Loading…" placeholder, with a turning spinner. Default is
// the centered list variant; override `className` for tighter/looser padding or
// inline use (e.g. className="" for a bare inline placeholder).
export default function LoadingState({ className = 'py-6 text-center' }: { className?: string }) {
  return (
    <div role="status" className={cn('text-xs text-faint', className)}>
      <span className="inline-flex items-center gap-2">
        <Loader2 className="size-3.5 animate-spin" />
        Loading…
      </span>
    </div>
  )
}

// A whole page still loading: the spinner in the middle of the space the page
// will fill. `screen` centers it in the viewport, for routes outside the shell.
export function PageLoading({ screen = false }: { screen?: boolean }) {
  return (
    <div
      role="status"
      className={cn(
        'flex animate-in fade-in-0 flex-col items-center justify-center gap-3 text-xs text-faint duration-300',
        screen ? 'h-screen' : 'min-h-[60vh]'
      )}
    >
      <Loader2 className="size-6 animate-spin text-primary" />
      Loading…
    </div>
  )
}
