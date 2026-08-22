import { GripIcon } from '@/shared/ui/icons'

/**
 * The grip that starts a drag-to-reorder gesture, so every reorderable list
 * grabs the same way. Spread `useDragReorder().handleProps(i)` onto it:
 *
 *   <DragHandle {...reorder.handleProps(i)} title="Drag to reorder" />
 */
export default function DragHandle({ className = '', ...props }: any) {
  return (
    <span
      aria-hidden
      className={`flex h-[26px] w-[14px] shrink-0 cursor-grab items-center justify-center text-ink-faint transition-colors hover:text-ink-dim active:cursor-grabbing ${className}`}
      {...props}
    >
      <GripIcon width={12} height={12} />
    </span>
  )
}
