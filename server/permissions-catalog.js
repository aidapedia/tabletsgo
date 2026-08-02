/**
 * The closed set of workspace permissions, and the roles every instance starts
 * with.
 *
 * A leaf module on purpose — it imports nothing, so both `server/permissions.js`
 * (which reads and writes the role rows) and `server/migrations.js` (which seeds
 * them) can use it without the dependency graph growing a cycle.
 *
 * **The catalog is code, the grants are data.** A permission exists here because
 * a route asks for it; roles are rows an instance admin edits. A role row holding
 * a key that isn't listed here is ignored rather than honoured, so a rolled-back
 * image can't be talked into enforcing a permission it doesn't understand.
 */

/**
 * Every permission a route can require, grouped for the admin UI.
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
      },
      { key: 'workspace.delete', label: 'Delete workspace', description: 'Permanently delete the workspace and everything inside it.' },
    ],
  },
  {
    group: 'People',
    items: [
      { key: 'members.manage', label: 'Manage members', description: 'Invite people, remove them, and change which role they hold.' },
      { key: 'teams.manage', label: 'Manage teams', description: 'Create, rename and delete teams, and change who belongs to them.' },
    ],
  },
  {
    group: 'Notifications',
    items: [
      {
        key: 'notifications.manage',
        label: 'Manage notifications',
        description: 'Choose who gets notified about backup failures and other workspace events.',
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
      },
    ],
  },
  {
    group: 'Connections',
    items: [
      { key: 'connections.create', label: 'Add connections', description: 'Create a new database connection in this workspace, or import one from a file.' },
      {
        key: 'connections.manage',
        label: 'Manage all connections',
        description: 'Edit, delete, export and set the access list of every connection in the workspace — not only the ones they own.',
      },
      {
        key: 'connections.transfer',
        label: 'Transfer connection ownership',
        description: 'Hand a connection over to a different member of the workspace.',
      },
    ],
  },
]

// Flat set of valid keys, for validation and for dropping unknown grants on read.
export const PERMISSION_KEYS = new Set(PERMISSIONS.flatMap((g) => g.items.map((i) => i.key)))

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
 */
export const BUILTIN_ROLES = [
  {
    slug: 'owner',
    name: 'Owner',
    description: 'Manages the workspace: its members, teams, settings, storage and connections.',
    permissions: [...PERMISSION_KEYS],
  },
  {
    slug: 'member',
    name: 'Member',
    description: 'Uses the connections they have been granted, and manages the ones they own.',
    permissions: [],
  },
]
