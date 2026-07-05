import { Link } from 'react-router-dom'
import { useWorkspaces } from '@/features/workspaces'
import { StorageList } from '@/features/backup'
import { Section } from './ui'

export default function S3Page() {
  const { current, currentId } = useWorkspaces()
  const enabled = !!current?.experiments?.s3Backup

  return (
    <Section title="S3 Storage" desc="Storage destinations connections can back up to.">
      {!enabled ? (
        <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-edge-strong py-20 text-center">
          <span className="rounded-[8px] border border-edge bg-elevated px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-faint">
            Beta
          </span>
          <h3 className="mt-4 text-[15px] font-semibold text-ink">S3 Storage & Backup is a beta experiment</h3>
          <p className="mt-1.5 max-w-[340px] text-[12px] leading-relaxed text-ink-dim">
            {current?.role === 'admin' ? (
              <>
                Turn it on in{' '}
                <Link to="/workspace/beta" className="text-green-bright underline-offset-2 hover:underline">
                  Workspace → Beta
                </Link>{' '}
                to use it.
              </>
            ) : (
              'Ask a workspace admin to enable it in Workspace → Beta.'
            )}
          </p>
        </div>
      ) : (
        currentId && <StorageList workspaceId={currentId} />
      )}
    </Section>
  )
}
