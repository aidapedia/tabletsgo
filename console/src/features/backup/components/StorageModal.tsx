import { useState } from 'react'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { toast } from 'sonner'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import PasswordInput from '@/shared/ui/form/PasswordInput'
import { createStorage, updateStorage, testStorage } from '@/features/backup/lib/api'
import type { StorageDestination } from '@/features/backup/lib/types'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Label } from '@/shared/ui/label'
import { Input } from '@/shared/ui/input'

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
    <SlideOverPanel
      show={show}
      close={close}
      width={480}
      onSubmit={handleSave}
      title={isEdit ? 'Edit Storage Destination' : 'New Storage Destination'}
      footer={
        <>
          {isEdit && (
            <Button type="button" variant="outline" size="lg" onClick={runTest} disabled={!valid || test === 'loading' || saving}>
              {test === 'loading' ? 'Testing…' : 'Test Connection'}
            </Button>
          )}
          <Button type="submit" variant="default" size="lg" disabled={!valid || saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Destination'}
          </Button>
        </>
      }
    >
      <div className="mb-[18px]">
              <Label className="mb-2">Name</Label>
              <Input placeholder="e.g. Backups (S3)" value={form.name} onChange={set('name')} required />
            </div>

            <div className="mb-[18px]">
              <Label className="mb-2">
                Endpoint <span className="text-faint">(optional — leave blank for AWS S3)</span>
              </Label>
              <Input placeholder="https://s3.us-west-2.amazonaws.com or http://minio.local:9000" value={form.endpoint} onChange={set('endpoint')} />
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <div className="mb-[18px]">
                <Label className="mb-2">Bucket</Label>
                <Input placeholder="my-backups" value={form.bucket} onChange={set('bucket')} required />
              </div>
              <div className="mb-[18px]">
                <Label className="mb-2">
                  Region <span className="text-faint">(optional)</span>
                </Label>
                <Input placeholder="us-east-1" value={form.region} onChange={set('region')} />
              </div>
            </div>

            <div className="mb-[18px]">
              <Label className="mb-2">
                Path prefix <span className="text-faint">(optional)</span>
              </Label>
              <Input placeholder="backups/" value={form.pathPrefix} onChange={set('pathPrefix')} />
            </div>

            <label className="mb-[18px] flex cursor-pointer items-center gap-2.5">
              <Checkbox onClick={(e) => e.stopPropagation()} checked={!!form.forcePathStyle} onCheckedChange={(checked) => setForm((f) => ({ ...f, forcePathStyle: (checked === true) }))} aria-label="Force path-style addressing" />
              <span className="text-[12px] text-muted-foreground">
                Force path-style addressing <span className="text-faint">(required by most non-AWS S3-compatible services, e.g. MinIO)</span>
              </span>
            </label>

            <div className="mb-[18px]">
              <Label className="mb-2">Access key ID</Label>
              <Input className="font-mono" value={form.accessKeyId} onChange={set('accessKeyId')} required />
            </div>
            <div className="mb-[18px]">
              <Label className="mb-2">Secret access key</Label>
              <PasswordInput className="font-mono" value={form.secretAccessKey} onChange={set('secretAccessKey')} required />
            </div>

      {test && test !== 'loading' && (
        <div
          className={`mt-1 mb-[18px] rounded-lg px-3.5 py-2.5 text-[11px] font-medium ${
            test.ok ? 'border border-primary/25 bg-primary/10 text-primary-bright' : 'border border-destructive/25 bg-destructive/10 text-[#ff9b9b]'
          }`}
        >
          {test.ok ? '✓ ' : '✕ '}
          {test.message}
        </div>
      )}
    </SlideOverPanel>
  )
}
