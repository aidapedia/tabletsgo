import Button from './Button.jsx'

/**
 * Small centered confirmation modal.
 * Props: title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]"
      onMouseDown={onCancel}
    >
      <div
        className="w-full max-w-[400px] animate-pop rounded-[16px] border border-edge-strong bg-panel p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        {message && <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">{message}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="subtle" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            size="sm"
            className={danger ? '!bg-red !text-white hover:!bg-red/90' : ''}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
