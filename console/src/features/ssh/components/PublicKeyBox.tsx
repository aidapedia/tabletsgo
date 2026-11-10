import { toast } from 'sonner'
import { CopyIcon } from '@/shared/ui/icons'
import type { SshKey } from '../types'
import { Button } from '@/shared/ui/button'

// A key's public half, copyable — the line someone appends to the bastion's
// ~/.ssh/authorized_keys. Its fingerprint sits under it so it can be checked
// against `ssh-keygen -lf` on the other end.
export default function PublicKeyBox({ sshKey }: { sshKey: SshKey }) {
  return (
    <div>
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted px-3 py-2.5">
        <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-muted-foreground">{sshKey.publicKey}</code>
        <Button variant="link" size="inline" type="button"
          className="text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Copy public key"
          onClick={() => {
            navigator.clipboard?.writeText(sshKey.publicKey)
            toast.success('Public key copied.')
          }}
        >
          <CopyIcon width={15} height={15} />
        </Button>
      </div>
      <p className="mt-2 font-mono text-[11px] text-faint">{sshKey.fingerprint}</p>
    </div>
  )
}
