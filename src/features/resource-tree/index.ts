// Resource tree — the one hierarchy of everything on the instance, and the place
// a role is granted. Application → Workspace → Group → {Connection, Storage} →
// {Dashboard, Workflow}. A group is both a folder and a set of people, so it is
// also what a grant is made to; ownership and grants cascade down the tree. See
// server/resource-tree.js for how a permission actually resolves.
export { default as ResourceTree } from './components/ResourceTree'
export { default as NodeDetail } from './components/NodeDetail'
export { default as NodeIcon } from './components/NodeIcon'
export { default as MoveNodeDialog } from './components/MoveNodeDialog'
export { useResourceTree } from './hooks/useResourceTree'
export { nestNodes, nodeHref, TYPE_LABEL } from './lib/tree'
export * from './api'
export type { AccessSource, GrantableRole, NodeAccess, NodeKind, NodeMember, NodeType, NodeTypeMeta, PrincipalType, ResourceGrant, ResourceNode, TreeCatalog } from './types'
export type { NodeDetail as NodeDetailData } from './types'
