import { useState } from 'react'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { useToast } from '@/shared/ui/feedback/Toast'
import Button from '@/shared/ui/buttons/Button'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import Segmented from '@/shared/ui/form/Segmented'
import Select from '@/shared/ui/form/Select'
import { Input, Textarea, controlClass } from '@/shared/ui/form/Input'
import PasswordInput from '@/shared/ui/form/PasswordInput'
import { Label } from '@/shared/ui/form/Form'
import { createSshKey, renameSshKey } from '../lib/api'
import type { SshKey, SshKeyAlgorithm } from '../types'
import PublicKeyBox from './PublicKeyBox'

const ALGORITHMS: { value: SshKeyAlgorithm; label: string; hint?: string }[] = [
  { value: 'ed25519', label: 'Ed25519', hint: 'recommended' },
  { value: 'ecdsa', label: 'ECDSA P-256' },
  { value: 'rsa', label: 'RSA 4096', hint: 'for older servers' },
]

// Create (generate or import) / view+rename slide-over for an SSH key. A key's
// material never changes after creation, so editing is only its name — and the
// view is where its public key is copied from. Creating one lands on that view,
// since the next thing anyone does with a new key is install its public half.
export default function SshKeyModal({
  workspaceId,
  initial,
  canManage,
  onClose,
  onSaved,
}: {
  workspaceId: string
  initial?: SshKey | null
  canManage: boolean
  onClose: () => void
  onSaved: (k: SshKey) => void
}) {
  const toast = useToast()
  const { show, close } = useSlideOver(onClose)
  const [saved, setSaved] = useState<SshKey | null>(initial || null)
  const [name, setName] = useState(initial?.name || '')
  const [mode, setMode] = useState<'generate' | 'import'>('generate')
  const [algorithm, setAlgorithm] = useState<SshKeyAlgorithm>('ed25519')
  const [privateKey, setPrivateKey] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [saving, setSaving] = useState(false)

  const valid = name.trim() && (saved || mode === 'generate' || privateKey.trim())

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || saving || !canManage) return
    setSaving(true)
    try {
      const key = saved
        ? await renameSshKey(saved.id, name.trim())
        : await createSshKey({ workspaceId, name: name.trim(), mode, algorithm, privateKey, passphrase: passphrase || undefined })
      onSaved(key)
      if (saved) {
        toast.success(`Saved "${key.name}".`)
        close()
      } else {
        toast.success(`Created "${key.name}" — add its public key to your SSH host.`)
        setSaved(key)
        setPrivateKey('')
        setPassphrase('')
      }
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SlideOverPanel
      show={show}
      close={close}
      width={520}
      onSubmit={handleSave}
      title={saved ? 'SSH Key' : 'New SSH Key'}
      footer={
        canManage && (
          <Button type="submit" variant="primary" size="lg" disabled={!valid || saving || (!!saved && name.trim() === saved.name)}>
            {saving ? 'Saving…' : saved ? 'Save Name' : mode === 'generate' ? 'Generate Key' : 'Import Key'}
          </Button>
        )
      }
    >
      <div className="mb-[18px]">
        <Label>Name</Label>
        <Input placeholder="e.g. Production bastion" value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} required />
      </div>

      {saved ? (
        <div className="mb-[18px]">
          <Label>Public key</Label>
          <PublicKeyBox sshKey={saved} />
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
            Append this line to <span className="text-ink-dim">~/.ssh/authorized_keys</span> on each SSH host that uses it, for the user it logs in as.
            The private key stays in Tabletsgo, encrypted, and is never shown again.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-[18px]">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'generate', label: 'Generate new' },
                { value: 'import', label: 'Import existing' },
              ]}
            />
          </div>

          {mode === 'generate' ? (
            <div className="mb-[18px]">
              <Label>Algorithm</Label>
              <Select className={controlClass} value={algorithm} onChange={(v) => setAlgorithm(v)} options={ALGORITHMS} />
              <p className="mt-2 text-[11px] text-ink-faint">
                A fresh keypair is made by Tabletsgo. You get the public key to install; the private key never leaves.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-[18px]">
                <Label>Private key</Label>
                <Textarea
                  className="min-h-[180px] font-mono text-[11px]"
                  placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----'}
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="mb-[18px]">
                <Label>
                  Passphrase <span className="text-ink-faint">(only if the key is encrypted)</span>
                </Label>
                <PasswordInput value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
              </div>
            </>
          )}
        </>
      )}
    </SlideOverPanel>
  )
}
