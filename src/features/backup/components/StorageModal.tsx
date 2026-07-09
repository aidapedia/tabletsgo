import { useState } from 'react'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { useToast } from '@/shared/ui/feedback/Toast'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import Checkbox from '@/shared/ui/form/Checkbox'
import { Input, controlClass } from '@/shared/ui/form/Input'
import { Label } from '@/shared/ui/form/Form'
import { CloseIcon } from '@/shared/ui/icons'
import { createStorage, updateStorage, testStorage } from '@/features/backup/lib/api'
import type { StorageDestination } from '@/features/backup/lib/types'

const blank = {
  name: '',
  endpoint: '',
  region: '',
  bucket: '',
  pathPrefix: '',
  forcePathStyle: false,
  accessKeyId: '',
  secretAccessKey: '',
}

// Create/edit slide-over for a storage destination — minus the dialect
// picker (there's only one "type": S3-compatible).
export default function StorageModal({
  workspaceId,
  initial,
  onClose,
  onSaved,
}: {
  workspaceId: string
  initial?: StorageDestination | null
  onClose: () => void
  onSaved: (s: StorageDestination) => void
}) {
  const toast = useToast()
  const { show, close } = useSlideOver(onClose)
  const isEdit = !!initial
  const [form, setForm] = useState(() => ({ ...blank, ...initial }))
  const [saving, setSaving] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; message: string } | 'loading' | null>(null)

  const set = (key: string) => (e: any) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
    setTest(null)
  }

  const valid = form.name.trim() && form.bucket.trim() && form.accessKeyId.trim() && form.secretAccessKey.trim()

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    try {
      const payload = { ...form, name: form.name.trim(), bucket: form.bucket.trim() }
      const saved = isEdit ? await updateStorage(initial!.id, payload) : await createStorage({ workspaceId, ...payload })
      toast.success(`Saved "${saved.name}".`)
      close(() => onSaved(saved))
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Test whatever's on the form: save first (edit-in-place for an existing
  // destination, since the test route needs stored/decryptable credentials),
  // then hit the test route.
  const runTest = async () => {
    if (!valid || !isEdit) return
    setTest('loading')
    try {
      await updateStorage(initial!.id, form)
      const result = await testStorage(initial!.id)
      setTest(result)
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    } catch (err: any) {
      setTest({ ok: false, message: err.message })
      toast.error(err.message)
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end bg-black/50 transition-opacity duration-200 ${show ? 'opacity-100' : 'opacity-0'}`}
      onMouseDown={() => close()}
    >
      <div
        className={`flex h-full w-full max-w-[480px] flex-col border-l border-edge-strong bg-panel shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.8)] transition-transform duration-200 ease-out ${
          show ? 'translate-x-0' : 'translate-x-full'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSave} className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-edge px-6 py-[18px]">
            <h3 className="text-sm font-bold">{isEdit ? 'Edit Storage Destination' : 'New Storage Destination'}</h3>
            <IconButton size="toolbar" className="!rounded-[9px]" onClick={() => close()} aria-label="Close">
              <CloseIcon />
            </IconButton>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="mb-[18px]">
              <Label>Name</Label>
              <Input placeholder="e.g. Backups (S3)" value={form.name} onChange={set('name')} required />
            </div>

            <div className="mb-[18px]">
              <Label>
                Endpoint <span className="text-ink-faint">(optional — leave blank for AWS S3)</span>
              </Label>
              <Input placeholder="https://s3.us-west-2.amazonaws.com or http://minio.local:9000" value={form.endpoint} onChange={set('endpoint')} />
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <div className="mb-[18px]">
                <Label>Bucket</Label>
                <Input placeholder="my-backups" value={form.bucket} onChange={set('bucket')} required />
              </div>
              <div className="mb-[18px]">
                <Label>
                  Region <span className="text-ink-faint">(optional)</span>
                </Label>
                <Input placeholder="us-east-1" value={form.region} onChange={set('region')} />
              </div>
            </div>

            <div className="mb-[18px]">
              <Label>
                Path prefix <span className="text-ink-faint">(optional)</span>
              </Label>
              <Input placeholder="backups/" value={form.pathPrefix} onChange={set('pathPrefix')} />
            </div>

            <label className="mb-[18px] flex cursor-pointer items-center gap-2.5">
              <Checkbox checked={!!form.forcePathStyle} onChange={(v) => setForm((f) => ({ ...f, forcePathStyle: v }))} ariaLabel="Force path-style addressing" />
              <span className="text-[12px] text-ink-dim">
                Force path-style addressing <span className="text-ink-faint">(required by most non-AWS S3-compatible services, e.g. MinIO)</span>
              </span>
            </label>

            <div className="mb-[18px]">
              <Label>Access key ID</Label>
              <Input className="font-mono" value={form.accessKeyId} onChange={set('accessKeyId')} required />
            </div>
            <div className="mb-[18px]">
              <Label>Secret access key</Label>
              <Input className="font-mono" type="password" value={form.secretAccessKey} onChange={set('secretAccessKey')} required />
            </div>

            {test && test !== 'loading' && (
              <div
                className={`mt-1 mb-[18px] rounded-soft px-3.5 py-2.5 text-[11px] font-medium ${
                  test.ok ? 'border border-green-dim bg-green/10 text-green-bright' : 'border border-red/25 bg-red/10 text-[#ff9b9b]'
                }`}
              >
                {test.ok ? '✓ ' : '✕ '}
                {test.message}
              </div>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-3 border-t border-edge px-6 py-[18px]">
            {isEdit && (
              <Button type="button" variant="ghost" size="lg" onClick={runTest} disabled={!valid || test === 'loading' || saving}>
                {test === 'loading' ? 'Testing…' : 'Test Connection'}
              </Button>
            )}
            <Button type="submit" variant="primary" size="lg" disabled={!valid || saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Destination'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
