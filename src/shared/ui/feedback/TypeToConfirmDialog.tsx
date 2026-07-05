import { useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import { Input } from '@/shared/ui/form/Input'
import { FormField } from '@/shared/ui/form/Form'

/**
 * Centered confirmation modal for destructive/irreversible actions that need
 * more friction than a plain confirm — the confirm button stays disabled
 * until the user types `confirmText` exactly (e.g. the connection name).
 * Props: title, message, confirmText, confirmLabel, cancelLabel, onConfirm, onCancel.
 */
export default function TypeToConfirmDialog({
  title,
  message,
  confirmText,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  const [value, setValue] = useState('')
  const matches = value === confirmText

  return (
    <div
      className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]"
      onMouseDown={onCancel}
    >
      <div
        className="w-full max-w-[420px] animate-pop rounded-[16px] border border-edge-strong bg-panel p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        {message && <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">{message}</p>}
        <FormField label={`Type "${confirmText}" to confirm`} className="mt-4">
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={confirmText}
            onKeyDown={(e) => e.key === 'Enter' && matches && onConfirm()}
          />
        </FormField>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="subtle" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!matches}
            className="!bg-red !text-white hover:!bg-red/90 disabled:!bg-red/40"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
