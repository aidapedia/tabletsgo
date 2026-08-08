/**
 * The closed set of permissions, the node types the resource tree is built from,
 * and the roles every instance starts with.
 *
 * A leaf module on purpose — it imports nothing, so `server/permissions.js`
 * (which reads and writes the role rows), `server/resource-tree.js` (which
 * validates nodes and grants) and `server/migrations.js` (which seeds them) can
 * all use it without the dependency graph growing a cycle.
 *
 * **The catalog is code, the grants are data.** A permission exists here because
 * a route asks for it; roles and grants are rows an instance admin edits. A row
 * holding a key that isn't listed here is ignored rather than honoured, so a
 * rolled-back image can't be talked into enforcing a permission it doesn't
 * understand.
 */

// ---- Node types: the shape of the resource tree ----

/**
 * Two kinds of node, and the rule that separates them:
 *
 *   group     — holds other nodes. A grant made here is what cascades.
 *   resource   — a leaf-ish thing someone actually uses (a connection, a
 *                dashboard). It may still hold resources of its own (a
 *                dashboard lives under its connection), but it is never where
 *                you organise the tree.
 *
 * `children` is the closed list of types a node may parent. It is the structural
 * half of a grant's *requirement criteria*: the tree cannot be bent into a shape
 * the resolver was never written for (a workspace under a connection, a group at
 * the root), so walking to the root is always well-defined.
 */
export const NODE_TYPES = [
  {
    type: 'application',
    kind: 'group',
    label: 'Application',
    description: 'The instance root. Everything on this instance hangs off it.',
    children: ['workspace'],
    // Created by the migration, never by a route: exactly one exists.
    singleton: true,
  },
  {
    type: 'workspace',
    kind: 'group',
    label: 'Workspace',
    description: 'One tenant: its groups, its connections and its storage.',
    children: ['group', 'connection', 'storage'],
    // Mirrors a row in another table, so the tree never creates or deletes it
    // on its own — the resource's own route does, through a hook.
    mirrors: 'workspaces',
  },
  {
    type: 'group',
    kind: 'group',
    label: 'Group',
    // Both jobs at once, which is the point: a folder resources are filed under,
    // and a named set of people a grant can be made to. `node_members` holds the
    // people; `resource_grants` names the group as a principal. Superseded the
    // separate `team` type in meta migration v15.
    description: 'A folder you create to organise resources, hold people, and scope access.',
    children: ['group', 'connection', 'storage'],
    // The only type a user creates directly — it mirrors nothing.
    custom: true,
  },
  {
    type: 'connection',
    kind: 'resource',
    label: 'Connection',
    description: 'A database connection.',
    children: ['dashboard', 'workflow'],
    mirrors: 'connections',
  },
  {
    type: 'storage',
    kind: 'resource',
    label: 'Storage',
    description: 'An S3-compatible destination backups are written to.',
    children: [],
    mirrors: 'storage_destinations',
  },
  {
    type: 'dashboard',
    kind: 'resource',
    label: 'Dashboard',
    description: 'A query dashboard built on a connection.',
    children: [],
    mirrors: 'dashboards',
  },
  {
    type: 'workflow',
    kind: 'resource',
    label: 'Workflow',
    description: 'A node-graph automation built on a connection.',
    children: [],
    mirrors: 'workflows',
  },
]

export const NODE_TYPE_KEYS = new Set(NODE_TYPES.map((n) => n.type))

export const nodeType = (type) => NODE_TYPES.find((n) => n.type === type) || null

// Types a user may create by hand. Everything else appears because its resource
// was created, and disappears with it.
export const CUSTOM_NODE_TYPES = NODE_TYPES.filter((n) => n.custom).map((n) => n.type)

/** May a node of type `parent` hold a child of type `child`? */
export const canParent = (parent, child) => !!nodeType(parent)?.children.includes(child)

/** The root type — the one node with no parent. */
export const ROOT_NODE_TYPE = 'application'

// ---- Permissions ----

/**
 * Every permission a route can require, grouped for the admin UI.
 *
 * `scope` is the **shallowest node type the permission means anything at**. It is
 * the semantic half of a grant's requirement criteria: `workspace.manage` granted
 * on a single connection node would be a promise the routes can't keep, because
 * no route ever asks that question at connection scope. `server/resource-tree.js`
 * refuses such a grant rather than storing one that silently does nothing.
 *
 * Note what is deliberately *absent*: using a database — running queries, editing
 * rows, workflows, dashboards, schema changes — is not a permission. That access
 * is a per-resource grant on the connection itself (`connection_access`), not a
 * workspace-wide capability, and folding it in here would give two different
 * answers to the same question.
 */
export const PERMISSIONS = [
  {
    group: 'Workspace',
    items: [
      {
        key: 'workspace.manage',
        label: 'Manage workspace',
        description: 'Rename the workspace and change its general settings, experiments and session policy.',
        scope: 'workspace',
      },
      {
        key: 'workspace.delete',
        label: 'Delete workspace',
        description: 'Permanently delete the workspace and everything inside it.',
        scope: 'workspace',
      },
    ],
  },
  {
    group: 'People',
    items: [
      { key: 'members.manage', label: 'Manage members', description: 'Invite people, remove them, and change which role they hold.', scope: 'workspace' },
      {
        // Key deliberately unchanged: `role_permissions` stores these strings and
        // drops unknown ones on read, so renaming it would silently strip the
        // power from every role already holding it. Only the wording moved on
        // when teams became groups (meta migration v15).
        key: 'teams.manage',
        label: 'Manage group membership',
        description: 'Change who belongs to a group — which decides who every grant made to that group reaches.',
        scope: 'workspace',
      },
    ],
  },
  {
    group: 'Notifications',
    items: [
      {
        key: 'notifications.manage',
        label: 'Manage notifications',
        description: 'Choose who gets notified about backup failures and other workspace events.',
        scope: 'workspace',
      },
    ],
  },
  {
    group: 'Storage',
    items: [
      {
        key: 'storage.manage',
        label: 'Manage storage destinations',
        description: 'Add, edit and delete the S3-compatible destinations backups are written to.',
        scope: 'workspace',
      },
    ],
  },
  {
    group: 'Connections',
    items: [
      {
        key: 'connections.create',
        label: 'Add connections',
        description: 'Create a new database connection in this workspace, or import one from a file.',
        scope: 'workspace',
      },
      {
        key: 'connections.manage',
        label: 'Manage all connections',
        description: 'Edit, delete, export and set the access list of every connection in the workspace — not only the ones they own.',
        scope: 'connection',
      },
      {
        key: 'connections.transfer',
        label: 'Transfer connection ownership',
        description: 'Hand a connection over to a different member of the workspace.',
        scope: 'connection',
      },
    ],
  },
  {
    group: 'Resource tree',
    items: [
      {
        key: 'resources.organise',
        label: 'Organise resources',
        description: 'Create, rename, move and delete the groups that resources are filed under.',
        scope: 'workspace',
      },
      {
        key: 'resources.grant',
        label: 'Grant access on resources',
        description: 'Give a person or group a role on a node, and take it away again.',
        scope: 'workspace',
      },
    ],
  },
]

// Flat set of valid keys, for validation and for dropping unknown grants on read.
export const PERMISSION_KEYS = new Set(PERMISSIONS.flatMap((g) => g.items.map((i) => i.key)))

// key → the shallowest node type it is meaningful at (see PERMISSIONS.scope).
export const PERMISSION_SCOPE = new Map(PERMISSIONS.flatMap((g) => g.items.map((i) => [i.key, i.scope])))

/**
 * The permission that makes a role count as owning a workspace. Named so the
 * "a workspace never loses its last owner" rule is greppable: the invariant is
 * really "at least one member holds `workspace.manage`", which is what keeps a
 * workspace manageable no matter how the roles have been redefined.
 */
export const OWNER_PERMISSION = 'workspace.manage'

/**
 * The two roles seeded on every instance. They are ordinary rows — an admin may
 * rename them and change what `member` grants — with two exceptions enforced in
 * server/permissions.js: a built-in can't be deleted (memberships reference its
 * slug), and `owner` can never lose OWNER_PERMISSION.
 *
 * Their slugs match the literals `workspace_members.role` held before roles
 * became configurable, so no membership row had to be rewritten.
 *
 * `appliesTo` is the node types the role may be granted on — the criteria an
 * admin controls, alongside the per-permission `scope` above which they don't.
 * `null` means "any type".
 */
export const BUILTIN_ROLES = [
  {
    slug: 'owner',
    name: 'Owner',
    description: 'Manages the workspace: its members, groups, settings, storage and connections.',
    permissions: [...PERMISSION_KEYS],
    appliesTo: ['application', 'workspace'],
  },
  {
    slug: 'member',
    name: 'Member',
    description: 'Uses the connections they have been granted, and manages the ones they own.',
    permissions: [],
    appliesTo: null,
  },
]
