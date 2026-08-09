/**
 * The resource tree as the client sees it. Mirrors server/resource-tree.js and
 * server/permissions-catalog.js — the node types and the grant shape are the
 * server's, not ours to invent.
 */

/** A group holds other nodes; a resource is a thing you use. */
export type NodeKind = 'group' | 'resource'

export type NodeType = 'application' | 'workspace' | 'group' | 'connection' | 'storage' | 'dashboard' | 'workflow'

export type ResourceNode = {
  id: string
  parentId: string | null
  kind: NodeKind
  type: NodeType
  resourceId: string | null
  name: string
  ownerId: string | null
  workspaceId: string | null
  path: string
  depth: number
  createdAt?: number
  updatedAt?: number
  /** True when this node is only in the payload so its descendants have a path
   *  back to the root — the caller holds nothing here. */
  context?: boolean
  /** True when the signed-in user owns this node outright. */
  owned?: boolean
  /** Connections only: whether the caller may actually open the database. */
  canOpen?: boolean
  /** Groups only: how many people a grant to this group would reach. */
  memberCount?: number
  /** May the caller reorganise here — file something new into this group, and
   *  move this node elsewhere? Resolved at this node, so a grant deep in the
   *  tree answers yes without one above it. */
  canOrganise?: boolean
}

/** Who a grant is for: one person, or a group node standing for its roster. */
export type PrincipalType = 'user' | 'node'

export type ResourceGrant = {
  id: string
  nodeId: string
  principalType: PrincipalType
  principalId: string
  principalName: string | null
  principalEmail: string | null
  roleSlug: string
  inherit: boolean
  createdAt: number
}

/** GET /api/resource-tree/:id — one node in full. */
export type NodeDetail = {
  node: ResourceNode
  /** True when the caller holds nothing here — the node is in the tree only so
   *  what they *do* hold has a path back to the root. Grants and members come
   *  back empty in that case; they aren't the caller's to read. */
  context?: boolean
  ancestors: ResourceNode[]
  children: ResourceNode[]
  grants: ResourceGrant[]
  /** Groups only: who is inside this one. */
  members?: NodeMember[]
  /** Everyone who can reach this node, resolved up the chain, and why. */
  people?: NodeAccess[]
  /** What the *caller* may do at this node. */
  permissions: string[]
  owner: { id: string; email: string; name: string; role: string } | null
}

/** Why one person can reach a node — a grant here, one above, a group, or ownership. */
export type AccessSource = {
  type: 'owner' | 'grant' | 'group'
  /** The grant this row came from — absent on an `owner` source, which is a
   *  column on the node rather than a grant. Only revocable when `here`. */
  grantId?: string
  /** The node the grant was made on (or the owned ancestor). */
  nodeId: string
  nodeName: string
  roleSlug?: string
  roleName?: string
  /** The group whose roster let them in, when `type` is 'group'. */
  groupId?: string
  groupName?: string
  /** True when it was granted on this very node rather than inherited. */
  here?: boolean
  /** Granted above every workspace, so it reaches in without a membership. */
  instanceWide?: boolean
}

/** One person who can reach a node, with every path that lets them. */
export type NodeAccess = {
  userId: string
  name: string
  email: string
  owner: boolean
  /** False = permissions but no data access: opening a database needs membership. */
  member: boolean
  /** Connection nodes only: may they actually *open* this database? Permissions
   *  reach down the tree, opening a connection does not — it is answered per
   *  resource by `userCanAccessConnection` (membership, where it is filed, its
   *  access list). Undefined on every other node type, where there is nothing to
   *  open. */
  canOpen?: boolean
  permissions: string[]
  sources: AccessSource[]
}

/** A person inside a group. Membership is flat — a group holds users, not groups. */
export type NodeMember = {
  userId: string
  email: string
  name: string
  createdAt?: number
}

/** One entry of the node-type catalog the server publishes. */
export type NodeTypeMeta = {
  type: NodeType
  kind: NodeKind
  label: string
  description: string
  children: NodeType[]
  custom?: boolean
  mirrors?: string
  singleton?: boolean
}

export type GrantableRole = {
  slug: string
  name: string
  description: string
  builtin: boolean
  permissions: string[]
  /** Node types an admin restricted this role to; null = anywhere. */
  appliesTo: NodeType[] | null
  /** Where it may actually be granted, criteria already applied. */
  grantableOn: NodeType[]
}

export type TreeCatalog = {
  nodeTypes: NodeTypeMeta[]
  roles: GrantableRole[]
}
