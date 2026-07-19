// Curated icon set offered for table row-action buttons. Keys are stored in the
// dashboard config (Widget.rowActions[].icon), so treat them as a stable
// contract — rename freely in the label, never the key.

import type { ComponentType } from 'react'
import {
  BellIcon,
  BranchIcon,
  CheckIcon,
  CloseIcon,
  CloudIcon,
  DownloadIcon,
  EditIcon,
  MailIcon,
  PlayIcon,
  RefreshIcon,
  TrashIcon,
  UploadIcon,
} from '@/shared/ui/icons'

type IconType = ComponentType<{ width?: number; height?: number; className?: string }>

export const ROW_ACTION_ICONS: Record<string, { label: string; Icon: IconType }> = {
  play: { label: 'Play', Icon: PlayIcon },
  refresh: { label: 'Retry', Icon: RefreshIcon },
  check: { label: 'Approve', Icon: CheckIcon },
  close: { label: 'Reject', Icon: CloseIcon },
  trash: { label: 'Delete', Icon: TrashIcon },
  mail: { label: 'Email', Icon: MailIcon },
  bell: { label: 'Notify', Icon: BellIcon },
  download: { label: 'Export', Icon: DownloadIcon },
  upload: { label: 'Upload', Icon: UploadIcon },
  branch: { label: 'Branch', Icon: BranchIcon },
  cloud: { label: 'Sync', Icon: CloudIcon },
  edit: { label: 'Edit', Icon: EditIcon },
}

export const ROW_ACTION_ICON_KEYS = Object.keys(ROW_ACTION_ICONS)

/** Resolve a stored icon key to its component, or undefined if unset/unknown. */
export function rowActionIcon(key?: string): IconType | undefined {
  return key ? ROW_ACTION_ICONS[key]?.Icon : undefined
}
