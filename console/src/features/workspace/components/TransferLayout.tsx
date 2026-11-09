import type { ReactNode } from 'react'
import { Checkbox } from '@/shared/ui/checkbox'

/**
 * The Export / Import panel's frame: a toolbar across the top, a list column on
 * the left (tables to pick, the file to read) and the preview filling the rest.
 * Both modes share it so switching between them doesn't move anything.
 */
export default function TransferLayout({
  toolbar,
  side,
  previewTitle,
  preview,
}: {
  toolbar: ReactNode
  side: ReactNode
  previewTitle: ReactNode
  preview: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">{toolbar}</div>
      <div className="flex min-h-0 flex-1 max-[720px]:flex-col">
        <div className="flex min-h-0 w-[300px] shrink-0 flex-col border-r border-border max-[720px]:max-h-[45%] max-[720px]:w-full max-[720px]:border-b max-[720px]:border-r-0">
          {side}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <SectionHeader>{previewTitle}</SectionHeader>
          <div className="min-h-0 flex-1 overflow-auto">{preview}</div>
        </div>
      </div>
    </div>
  )
}

export const SectionHeader = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-[41px] items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
    {children}
  </div>
)

export const ToolbarDivider = () => <div className="h-5 w-px bg-border" />

// A checkbox with its label, for the toolbar options.
export const ToolbarCheck = ({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
}) => (
  <label className={`flex items-center gap-2 text-xs ${disabled ? 'cursor-not-allowed text-faint' : 'cursor-pointer text-muted-foreground'}`}>
    <Checkbox onClick={(e) => e.stopPropagation()} checked={checked} onCheckedChange={(checked) => onChange(checked === true)} disabled={disabled} aria-label={label} />
    {label}
  </label>
)

// One pickable table in the side list.
export const TableRow = ({
  checked,
  onChange,
  icon,
  name,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  icon: ReactNode
  name: string
}) => (
  <label className="flex cursor-pointer items-center gap-3 px-4 py-2 text-xs text-foreground hover:bg-accent">
    <Checkbox onClick={(e) => e.stopPropagation()} checked={checked} onCheckedChange={(checked) => onChange(checked === true)} aria-label={name} />
    <span className="shrink-0 text-faint">{icon}</span>
    <span className="min-w-0 truncate">{name}</span>
  </label>
)

export const PreviewMessage = ({ children, tone = 'faint' }: { children: ReactNode; tone?: 'faint' | 'error' }) => (
  <div className={`flex h-full items-center justify-center p-8 text-center text-xs ${tone === 'error' ? 'text-destructive' : 'text-faint'}`}>
    {children}
  </div>
)
