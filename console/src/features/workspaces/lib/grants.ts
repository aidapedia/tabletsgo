import type { GrantVia } from '../api'

// How a grant reaches a member, in words — the same everywhere it is shown.
export function viaLabel(via: GrantVia, groupName?: string | null) {
  switch (via) {
    case 'owner':
      return 'Owns it'
    case 'user':
      return 'Granted directly'
    case 'group':
      return groupName ? `Through group ${groupName}` : 'Through a group'
    case 'everyone':
      return 'Everyone in the workspace'
  }
}
