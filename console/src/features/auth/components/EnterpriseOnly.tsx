import { UsersIcon } from '@/shared/ui/icons'

/**
 * What a page about other people shows on a solo instance, where there is
 * nobody else: why, and what changes that. Pages gate on `useIdentity().people`.
 */
export default function EnterpriseOnly({ what = 'Members and their access' }: { what?: string }) {
  return (
    <div className="flex max-w-[560px] gap-4 rounded-xl border border-border bg-muted/30 p-5">
      <UsersIcon width={20} height={20} className="mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">{what} come with enterprise mode</div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
          This instance runs in solo mode: you are its only person, and you can do everything. To work with a team, connect it to
          Hayat. Your connections, workspace and settings move with you, and enterprise mode is free.
        </p>
        <a
          className="mt-2 inline-block text-[12px] text-primary-bright hover:underline"
          href="https://github.com/aidapedia/tabletsgo#moving-from-solo-to-enterprise"
          target="_blank"
          rel="noreferrer"
        >
          Moving from solo to enterprise
        </a>
      </div>
    </div>
  )
}
