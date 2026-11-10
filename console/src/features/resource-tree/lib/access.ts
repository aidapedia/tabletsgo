import type { AccessSource, GrantableRole, NodeAccess, ResourceGrant, ResourceNode } from '../types'

/**
 * One line in the access list: a principal, holding one role, through one path.
 *
 * The unit is deliberately the *path*, not the person. Someone who holds Admin
 * here and Viewer through a group above appears twice, because those are two
 * different things to revoke and collapsing them would hide one of them.
 */
export type AccessRow = {
  key: string
  /** A person, or a group standing for its roster. */
  kind: 'user' | 'group'
  name: string
  email?: string
  /** Where this row's access comes from — what the row's second line says. */
  source: AccessSource
  /** Group rows: the people the roster actually reaches. Empty roster = nobody. */
  reached: NodeAccess[]
  /** True when the grant lives on this node, so it can be revoked from here. */
  here: boolean
  grantId?: string
  /** Set for a grant on this node: false = applies to this node only. */
  inherit?: boolean
  /** Somebody on this row holds permissions here without workspace membership. */
  noData: boolean
}

export type AccessGroup = {
  slug: string
  label: string
  rows: AccessRow[]
}

/**
 * The grant a group makes to *its own roster* — written by `createGroupNode` so
 * a group means something the moment it exists.
 *
 * Pulled out of the rows because as a row it was unreadable: a person-shaped
 * entry carrying the group's own name, saying "granted here · group of 0",
 * while the roster it pays out to sat in a second panel further down. It is not
 * a path *to* this node — it is the answer to "what do the people in this group
 * get for being in it", which is the roster's heading, not a peer of it.
 */
export type RosterRole = {
  grantId: string
  roleSlug: string
  roleName: string
  inherit: boolean
}

export type AccessResult = {
  /** Groups only, and only once the self-grant exists — an admin may revoke it. */
  rosterRole: RosterRole | null
  groups: AccessGroup[]
  /**
   * `requireAccess` only: the people held back out of the rows because they
   * cannot open the resource. Returned rather than dropped — they do hold
   * permissions here, and a list that silently forgot them would be the same
   * audit hole in the other direction.
   */
  withoutAccess: NodeAccess[]
}

/**
 * Fold the resolved people and the node's own grants into one list grouped by
 * role.
 *
 * Two payload fields answer one question at different resolutions: `grants` is
 * what was granted *here*, and `people` is everyone who gets in once ancestors,
 * inheritance and group rosters are resolved. Shown as two lists they have to be
 * cross-referenced by hand; shown as one they read as what they are — the same
 * access, arriving by different routes.
 *
 * Ownership is deliberately *not* a row. It is not a grant: it has nothing to
 * revoke, nothing to edit and no role to sit under, so listing it only repeated
 * the owner under a heading that looked like the "Owner" role next to it. Who
 * owns the node is a property of the node, stated in the header.
 *
 * What must not blur in the merge is *where each row is edited*. Only a row whose
 * grant sits on this node can be revoked here (`here`); everything else names the
 * node it came from and sends you there, so a grant still lives in exactly one
 * place and this list can never disagree with it.
 *
 * `grants` is unioned in rather than trusted to fall out of `people`, because a
 * grant can reach nobody and still exist: a group with an empty roster, or one
 * made to a user who has since been deleted. Those rows are invisible in the
 * resolved view and would be unrevokable if this list were derived from it alone.
 *
 * Two things are lifted *out* of the rows, because rendering them here stated
 * one fact twice:
 *
 *  - the group's grant to its own roster, returned as `rosterRole` — it heads
 *    the roster instead of sitting beside it (see `RosterRole`);
 *  - any grant named in `absorbUserGrants`, for a caller that shows that grant
 *    on the person's roster row instead. A workspace passes its members: their
 *    membership and their role are written together by `addMember`, so listing
 *    the roster and then the same names again as grants was one act split in
 *    two. Never pass a grant this list is the only place to revoke.
 *
 * `requireAccess` narrows the resolved pass to the people who can actually *use*
 * the resource (`canOpen`, answered per connection by the server). On a
 * connection the two questions come apart: a workspace-wide grant reaches every
 * connection node in the workspace, while opening one is granted per connection,
 * so without this the list answers "who holds a role that reaches here" under a
 * heading everyone reads as "who has access". The people it holds back come out
 * in `withoutAccess`, and grants made *on this node* are unaffected — they are
 * unioned in from `grants` below, so nothing revocable here can be filtered
 * away.
 */
export function buildAccessRows(
  node: ResourceNode,
  people: NodeAccess[],
  grants: ResourceGrant[],
  roles: GrantableRole[],
  { absorbUserGrants, requireAccess }: { absorbUserGrants?: Set<string>; requireAccess?: boolean } = {}
): AccessResult {
  const buckets = new Map<string, AccessRow[]>()
  const index = new Map<string, AccessRow>()
  const localGrants = new Map(grants.map((g) => [g.id, g]))

  const push = (slug: string, row: AccessRow) => {
    const list = buckets.get(slug)
    list ? list.push(row) : buckets.set(slug, [row])
    index.set(row.key, row)
  }

  const withoutAccess: NodeAccess[] = []

  for (const person of people) {
    // Permissions that reach here without the access to use what is here. Held
    // back from every row, including a group's `reached` list, so a group's size
    // is the number of people it actually lets in.
    if (requireAccess && person.canOpen === false) {
      withoutAccess.push(person)
      continue
    }
    for (const source of person.sources) {
      // Ownership reaches this node without a grant behind it, so it has no row
      // here — see the note above.
      if (source.type === 'owner') continue

      // A grant's id identifies the row: a grant to a user reaches exactly that
      // user, and a grant to a group is one row however many people it reaches.
      // Shown on this person's roster row instead — see `absorbUserGrants`.
      if (source.here && source.type !== 'group' && absorbUserGrants?.has(person.userId)) continue

      const key = source.grantId
        ? `grant:${source.grantId}`
        : `${source.type}:${source.nodeId}:${source.roleSlug}:${source.groupId || person.userId}`
      const slug = source.roleSlug || 'unknown'
      const existing = index.get(key)
      if (existing) {
        if (source.type === 'group') {
          existing.reached.push(person)
          existing.noData ||= !person.member
        }
        continue
      }
      push(slug, {
        key,
        kind: source.type === 'group' ? 'group' : 'user',
        name: source.type === 'group' ? source.groupName || 'Group' : person.name || person.email,
        email: source.type === 'group' ? undefined : person.email,
        source,
        reached: source.type === 'group' ? [person] : [],
        here: !!source.here,
        grantId: source.grantId,
        inherit: source.grantId ? localGrants.get(source.grantId)?.inherit : undefined,
        noData: !person.member,
      })
    }
  }

  // Grants that reached nobody — still real, still revocable, so still listed.
  for (const g of grants) {
    const key = `grant:${g.id}`
    if (index.has(key)) continue
    if (g.principalType === 'user' && absorbUserGrants?.has(g.principalId)) continue
    const isGroup = g.principalType === 'node'
    push(g.roleSlug, {
      key,
      kind: isGroup ? 'group' : 'user',
      name: g.principalName || g.principalEmail || 'Unknown',
      email: isGroup ? undefined : g.principalEmail || undefined,
      source: {
        type: isGroup ? 'group' : 'grant',
        grantId: g.id,
        nodeId: node.id,
        nodeName: node.name,
        roleSlug: g.roleSlug,
        roleName: roleLabel(g.roleSlug, roles),
        groupId: isGroup ? g.principalId : undefined,
        groupName: isGroup ? g.principalName || undefined : undefined,
        here: true,
      },
      reached: [],
      here: true,
      grantId: g.id,
      inherit: g.inherit,
      noData: false,
    })
  }

  // The group's grant to itself heads the roster instead of being a row in here.
  // Matched on the grant's principal, not on its role: an admin may redefine or
  // re-grant it, and it is the *self* reference that makes it the roster's role.
  let rosterRole: RosterRole | null = null
  for (const [slug, rows] of buckets) {
    const at = rows.findIndex((r) => r.kind === 'group' && r.here && r.source.groupId === node.id)
    if (at < 0) continue
    const [row] = rows.splice(at, 1)
    if (row.grantId) {
      rosterRole = { grantId: row.grantId, roleSlug: slug, roleName: roleLabel(slug, roles, [row]), inherit: row.inherit !== false }
    }
    // A bucket that held only the self-grant is no longer a role anyone holds here.
    if (!rows.length) buckets.delete(slug)
    break
  }

  // The catalog's own order, so the list reads strongest-first the way the role
  // editor is arranged.
  const order = roles.map((r) => r.slug)
  const slugs = [...buckets.keys()].sort((a, b) => {
    const ai = order.indexOf(a)
    const bi = order.indexOf(b)
    if (ai !== bi) return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi)
    return a.localeCompare(b)
  })

  return {
    rosterRole,
    withoutAccess,
    groups: slugs.map((slug) => ({
      slug,
      label: roleLabel(slug, roles, buckets.get(slug)!),
      // Access granted here first: it's the part of the list that is actionable.
      rows: buckets.get(slug)!.sort((a, b) => Number(b.here) - Number(a.here) || a.name.localeCompare(b.name)),
    })),
  }
}

/**
 * What one person was granted *directly* on this node, if anything.
 *
 * The roster row's role chip: at a workspace every member has one of these
 * (`addMember` writes the seat and the grant together), so the chip is what lets
 * the roster absorb those grant rows instead of repeating the same names below.
 */
export function directRoleName(grants: ResourceGrant[], roles: GrantableRole[], userId: string) {
  const grant = grants.find((g) => g.principalType === 'user' && g.principalId === userId)
  return grant ? roleLabel(grant.roleSlug, roles) : null
}

/** The catalog's name for a role, falling back to whatever the source called it. */
function roleLabel(slug: string, roles: GrantableRole[], rows: AccessRow[] = []) {
  return roles.find((r) => r.slug === slug)?.name || rows[0]?.source.roleName || slug
}

/**
 * The sentence under a row: where this access comes from.
 *
 * The `owner` case can't reach a row today — `buildAccessRows` drops those
 * sources — but the payload type still carries it, and defaulting it to
 * "granted on" would state something untrue, so it keeps its own sentence.
 */
export function describeSource(source: AccessSource, nodeId: string) {
  if (source.type === 'owner') return source.nodeId === nodeId ? 'Owns this' : `Owns "${source.nodeName}"`
  if (source.here) return 'Granted here'
  return `Granted on "${source.nodeName}"`
}
