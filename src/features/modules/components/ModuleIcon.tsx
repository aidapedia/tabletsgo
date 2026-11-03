import { DbLogo, HistoryIcon } from '@/shared/ui/icons'
import type { PublicModule } from '../api'

// An engine is drawn with its database logo; a feature with a glyph tile the
// same size, so a mixed list lines up.
export default function ModuleIcon({ module, className = 'h-10 w-10' }: { module: Pick<PublicModule, 'id' | 'kind'>; className?: string }) {
  if (module.kind === 'engine') return <DbLogo type={module.id} className={`shrink-0 ${className}`} />
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-[11px] border border-edge-strong bg-elevated text-green ${className}`}>
      <HistoryIcon width={18} height={18} />
    </span>
  )
}
