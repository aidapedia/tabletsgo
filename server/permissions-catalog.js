/**
 * Every permission a route can ask for, and the contract tabletsgo publishes to
 * Hayat so those permissions exist there.
 *
 * A leaf module on purpose — it imports nothing, so `server/hayat`, `server/auth.js`
 * and the migrator's export can all use it without a cycle.
 *
 * **The catalog is code, the grants are data — in Hayat.** Who holds what is
 * decided in Hayat's console (roles, grants, group rosters); a permission exists
 * here because a route enforces it. Routes keep asking with the short key
 * (`requirePermission(req, res, wsId, 'storage.manage')`); `hayatKey` turns it
 * into the qualified name Hayat answers for. Some keys are Hayat's own platform
 * permissions — tabletsgo doesn't manage members or groups any more, but it still
 * shows people what they could do in Hayat's console.
 */

export const SERVICE = 'tabletsgo'

// Node types tabletsgo mirrors into Hayat's tree. A workspace *is* a Hayat
// tenant; groups are Hayat's own; connections and storage destinations are ours.
export const TENANT_TYPE = 'hayat/tenant'
export const GROUP_TYPE = 'hayat/group'
export const CONNECTION_TYPE = `${SERVICE}/connection`
export const STORAGE_TYPE = `${SERVICE}/storage`

/**
 * key       what routes ask for (and what the console's `permissions` arrays hold)
 * hayat     the qualified key in Hayat's catalog
 * scope     the shallowest node it means anything at — Hayat refuses a grant
 *           below it, so `workspace.manage` can't be handed out on one connection
 * contract  declared in tabletsgo's contract (false: a Hayat platform permission)
 */
export const PERMISSIONS = [
  {
    group: 'Instance',
    items: [
      {
        key: 'instance.manage',
        hayat: 'tabletsgo.instance.manage',
        label: 'Administer tabletsgo',
        description: 'Turn databases and features on and off, set the mail server, and update the instance.',
        scope: 'hayat/root',
        contract: true,
      },
    ],
  },
  {
    group: 'Workspace',
    items: [
      {
        key: 'workspace.manage',
        hayat: 'tabletsgo.workspace.manage',
        label: 'Manage workspace settings',
        description: 'Change the workspace’s experiments and session policy in tabletsgo.',
        scope: 'hayat/tenant',
        contract: true,
      },
      {
        key: 'workspace.delete',
        hayat: 'tabletsgo.workspace.delete',
        label: 'Remove workspace data',
        description: 'Delete everything tabletsgo holds for the workspace: connections, storage, SSH hosts and keys, drafts.',
        scope: 'hayat/tenant',
        contract: true,
      },
      {
        key: 'notifications.manage',
        hayat: 'tabletsgo.notifications.manage',
        label: 'Manage notifications',
        description: 'Choose who gets notified about backup failures and other workspace events.',
        scope: 'hayat/tenant',
        contract: true,
      },
    ],
  },
  {
    group: 'People (managed in Hayat)',
    items: [
      { key: 'members.manage', hayat: 'hayat.members.manage', label: 'Manage members', description: 'Add people to the workspace and remove them.', scope: 'hayat/tenant', contract: false },
      { key: 'teams.manage', hayat: 'hayat.groups.manage', label: 'Manage group membership', description: 'Change who belongs to a group.', scope: 'hayat/group', contract: false },
      { key: 'resources.organise', hayat: 'hayat.resources.organise', label: 'Organise resources', description: 'Create, rename, move and delete groups, and move resources between them.', scope: 'hayat/group', contract: false },
      { key: 'resources.grant', hayat: 'hayat.resources.grant', label: 'Grant access', description: 'Give a person or group a role on a node, and take it away.', scope: 'hayat/group', contract: false },
    ],
  },
  {
    group: 'Storage and SSH',
    items: [
      {
        key: 'storage.manage',
        hayat: 'tabletsgo.storage.manage',
        label: 'Manage storage destinations',
        description: 'Add, edit and delete the S3-compatible destinations backups are written to.',
        scope: 'hayat/tenant',
        contract: true,
      },
      {
        key: 'ssh.manage',
        hayat: 'tabletsgo.ssh.manage',
        label: 'Manage SSH keys and gateways',
        description: 'Add, edit and delete the SSH keys and gateways connections tunnel through.',
        scope: 'hayat/tenant',
        contract: true,
      },
    ],
  },
  {
    group: 'Connections',
    items: [
      {
        key: 'connections.create',
        hayat: 'tabletsgo.connections.create',
        label: 'Add connections',
        description: 'Create a new database connection in this workspace, or import one from a file.',
        scope: 'hayat/tenant',
        contract: true,
      },
      {
        key: 'connections.manage',
        hayat: 'tabletsgo.connections.manage',
        label: 'Manage connections',
        description: 'Edit, delete and export connections — not only the ones they own.',
        scope: 'connection',
        contract: true,
      },
      {
        key: 'connections.transfer',
        hayat: 'tabletsgo.connections.transfer',
        label: 'Transfer connection ownership',
        description: 'Hand a connection over to a different member of the workspace.',
        scope: 'connection',
        contract: true,
      },
      {
        // New with Hayat: opening a database used to be a separate access list
        // (`connection_access`); in Hayat it is a grant like any other, and the
        // connection type names it as its access permission so group placement
        // and tenant membership apply to it.
        key: 'connection.open',
        hayat: 'tabletsgo.connection.open',
        label: 'Open connections',
        description: 'Query, browse and edit the data behind a connection, and use its dashboards and workflows.',
        scope: 'connection',
        contract: true,
      },
    ],
  },
]

const ITEMS = PERMISSIONS.flatMap((g) => g.items)

export const PERMISSION_KEYS = new Set(ITEMS.map((i) => i.key))
const TO_HAYAT = new Map(ITEMS.map((i) => [i.key, i.hayat]))
const FROM_HAYAT = new Map(ITEMS.map((i) => [i.hayat, i.key]))

/** 'storage.manage' → 'tabletsgo.storage.manage'. Throws on a key no route may ask for. */
export function hayatKey(key) {
  const k = TO_HAYAT.get(key)
  if (!k) throw new Error(`Unknown permission "${key}" — add it to server/permissions-catalog.js`)
  return k
}

/** Hayat's answer in our terms: qualified keys we don't know are dropped. */
export const shortKeys = (qualified) => new Set([...qualified].map((k) => FROM_HAYAT.get(k)).filter(Boolean))

/**
 * The roles tabletsgo suggests. Hayat creates them when the contract goes
 * live; an instance admin may make others in Hayat's console.
 *   admin            the instance's administrator (granted at the root)
 *   owner            runs a workspace in tabletsgo (the old built-in `owner`)
 *   connection-user  opens connections — what the old access list gave
 *   connection-manager  edits and opens them, without owning
 */
export const CONTRACT_ROLES = [
  { slug: 'admin', name: 'Tabletsgo admin', description: 'Administers this tabletsgo instance.', permissions: ['instance.manage'], appliesTo: ['hayat/root'] },
  {
    slug: 'owner',
    name: 'Workspace owner (tabletsgo)',
    description: 'Runs the workspace in tabletsgo: its settings, storage, SSH hosts and every connection.',
    permissions: ['workspace.manage', 'workspace.delete', 'notifications.manage', 'storage.manage', 'ssh.manage', 'connections.create', 'connections.manage', 'connections.transfer', 'connection.open'],
    appliesTo: ['hayat/root', 'hayat/tenant'],
  },
  {
    slug: 'connection-user',
    name: 'Connection user',
    description: 'Opens the connections at and below where it is granted.',
    permissions: ['connection.open'],
    appliesTo: ['hayat/tenant', 'hayat/group', 'connection'],
  },
  {
    slug: 'connection-manager',
    name: 'Connection manager',
    description: 'Edits, exports and opens the connections at and below where it is granted.',
    permissions: ['connections.manage', 'connection.open'],
    appliesTo: ['hayat/tenant', 'hayat/group', 'connection'],
  },
]

// Bump on every change below; a version only adds (Hayat refuses the rest).
export const CONTRACT_VERSION = 2

const contractKey = (key) => hayatKey(key).slice(SERVICE.length + 1)

/** The contract manifest, as JSON (Hayat reads YAML or JSON). */
export function contractManifest() {
  return JSON.stringify(
    {
      service: SERVICE,
      version: CONTRACT_VERSION,
      description: 'Database console: connections, storage destinations and who may use them.',
      resource_types: [
        {
          name: 'connection',
          description: 'A database connection.',
          parents: [TENANT_TYPE, GROUP_TYPE],
          // Opening is granted per connection; the roster of a group it is filed
          // under may open it; a non-member never can.
          access: { permission: 'connection.open', via_placement: true, requires_membership: true },
        },
        { name: 'storage', description: 'An S3-compatible destination backups are written to.', parents: [TENANT_TYPE, GROUP_TYPE] },
      ],
      permissions: ITEMS.filter((i) => i.contract).map((i) => ({ key: contractKey(i.key), scope: i.scope, label: i.label, description: i.description })),
      default_roles: CONTRACT_ROLES.map((r) => ({
        slug: r.slug,
        name: r.name,
        description: r.description,
        permissions: r.permissions.map(contractKey),
        applies_to: r.appliesTo,
      })),
    },
    null,
    2
  )
}

export const roleSlug = (slug) => `${SERVICE}.${slug}`
