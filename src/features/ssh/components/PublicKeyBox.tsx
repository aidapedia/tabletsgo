import { useToast } from '@/shared/ui/feedback/Toast'
import TextButton from '@/shared/ui/buttons/TextButton'
import { CopyIcon } from '@/shared/ui/icons'
import type { SshKey } from '../types'

// A key's public half, copyable — the line someone appends to the bastion's
// ~/.ssh/authorized_keys. Its fingerprint sits under it so it can be checked
// against `ssh-keygen -lf` on the other end.
export default function PublicKeyBox({ sshKey }: { sshKey: SshKey }) {
  const toast = useToast()
  return (
    <div>
      <div className="flex items-start gap-2 rounded-soft border border-edge bg-elevated px-3 py-2.5">
        <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-ink-dim">{sshKey.publicKey}</code>
        <TextButton
          className="shrink-0"
          aria-label="Copy public key"
          onClick={() => {
            navigator.clipboard?.writeText(sshKey.publicKey)
            toast.success('Public key copied.')
          }}
        >
          <CopyIcon width={15} height={15} />
        </TextButton>
      </div>
      <p className="mt-2 font-mono text-[11px] text-ink-faint">{sshKey.fingerprint}</p>
    </div>
  )
}
