import type { ReactNode } from 'react'
import { Logo } from '@/shared/ui/icons'

/** The centred card of the small signed-out pages. */
export default function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_50%_30%,rgba(111,207,106,0.06),transparent_60%)] bg-bg p-6">
      <div className="w-full max-w-[400px] rounded-[16px] border border-edge bg-panel p-8">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <span className="text-[18px] font-bold tracking-[-0.3px]">
            Tabl<span className="text-green">et</span>sgo
          </span>
        </div>
        {children}
      </div>
    </div>
  )
}
