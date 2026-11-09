import { useState, type ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { FormField } from '@/shared/ui/form/FormField'
import { Input } from '@/shared/ui/input'

/**
 * Confirm before acting — shadcn's AlertDialog. Mount it when the question is
 * being asked (`{pending && <ConfirmDialog … />}`); it is open while mounted
 * unless `open` says otherwise. Dismissing it in any way calls `onCancel`.
 *
 * `typeToConfirm` adds friction for what can't be undone: the confirm button
 * stays disabled until that exact text (a connection's name, say) is typed.
 */
export function ConfirmDialog({
  open = true,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  typeToConfirm,
  onConfirm,
  onCancel,
}: {
  open?: boolean
  title: ReactNode
  description?: ReactNode
  confirmLabel?: ReactNode
  cancelLabel?: ReactNode
  destructive?: boolean
  typeToConfirm?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const blocked = !!typeToConfirm && typed !== typeToConfirm

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {typeToConfirm && (
          <FormField label={`Type "${typeToConfirm}" to confirm`} className="!mb-0">
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={typeToConfirm}
              autoComplete="off"
              onKeyDown={(e) => e.key === 'Enter' && !blocked && onConfirm()}
            />
          </FormField>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel variant="ghost" size="sm">
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            size="sm"
            disabled={blocked}
            className={destructive ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
            onClick={(e) => {
              // The caller decides when it closes — usually by unmounting it.
              e.preventDefault()
              onConfirm()
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
