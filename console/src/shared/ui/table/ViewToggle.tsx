import type { ComponentType } from 'react'
import Segmented from '@/shared/ui/form/Segmented'
import { GridIcon, MenuIcon } from '@/shared/ui/icons'
import type { ListView } from './useListView'

/**
 * The List / Grid switch at the end of a list's search row. Pair it with
 * `useListView`; `ml-auto` is the default so it sits at the row's right edge.
 */
export default function ViewToggle({
  value,
  onChange,
  className = 'ml-auto shrink-0',
}: {
  value: ListView
  onChange: (view: ListView) => void
  className?: string
}) {
  return (
    <Segmented
      className={className}
      value={value}
      onChange={onChange}
      options={[
        { value: 'list', label: <Label icon={MenuIcon}>List</Label> },
        { value: 'grid', label: <Label icon={GridIcon}>Grid</Label> },
      ]}
    />
  )
}

function Label({ icon: Icon, children }: { icon: ComponentType<any>; children: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon width={12} height={12} />
      {children}
    </span>
  )
}
