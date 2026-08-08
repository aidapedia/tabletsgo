import type { ReactElement } from 'react'
import {
  BuildingIcon,
  CloudIcon,
  DatabaseIcon,
  FolderIcon,
  GridIcon,
  HomeIcon,
  UsersIcon,
  WandIcon,
} from '@/shared/ui/icons'
import type { NodeType } from '../types'

// One icon per node type, in one place — the tree, the detail header and the
// breadcrumb all read from here so a node looks the same wherever it appears.
// A group draws as people rather than as a folder: it is both a container and a
// roster, and the roster is the half that matters here — it is what a grant is
// made to, and what filing something inside it hands out.
const ICONS: Record<NodeType, (props: any) => ReactElement> = {
  application: HomeIcon,
  workspace: BuildingIcon,
  group: UsersIcon,
  connection: DatabaseIcon,
  storage: CloudIcon,
  dashboard: GridIcon,
  workflow: WandIcon,
}

export default function NodeIcon({
  type,
  size = 15,
  className = 'shrink-0 text-ink-faint',
}: {
  type: NodeType
  size?: number
  className?: string
}) {
  const Icon = ICONS[type] || FolderIcon
  return <Icon width={size} height={size} className={className} />
}
