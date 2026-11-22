/**
 * Which Hayat this tabletsgo needs.
 *
 * Every RPC tabletsgo sends to Hayat is listed here with the release it first
 * shipped in — the `// Since X.Y.Z.` line above it in Hayat's
 * proto/hayat/authz/v1/authz.proto. MIN_HAYAT_VERSION is the newest of them,
 * never below the floor (1.2.0, the first Hayat that reports its version).
 * Hayat's service API only grows, so any newer Hayat works too.
 *
 * Calling a new RPC means adding it here with its Since; the minimum follows.
 * tests/hayat-compat.test.js fails when server/ sends an RPC this table doesn't
 * list. A leaf: imports nothing.
 */

export const HAYAT_RPCS = {
  'AuthzService.Check': '1.0.0',
  'AuthzService.PermissionsAt': '1.0.0',
  'AuthzService.LookupSubjects': '1.0.0',
  'TreeService.UpsertResource': '1.0.0',
  'TreeService.DeleteResource': '1.0.0',
  'TreeService.GetResource': '1.0.0',
  'DirectoryService.BatchGetUsers': '1.0.0',
  'DirectoryService.ListUserTenants': '1.0.0',
  'DirectoryService.ListTenantMembers': '1.0.0',
  'DirectoryService.ListTenantGrants': '1.1.0',
  'DirectoryService.GetUserAppearance': '1.1.0',
  'WatchService.Watch': '1.0.0',
  'SchemaService.PublishContract': '1.0.0',
  'EnrollmentService.InspectEnrollment': '1.2.0',
  'EnrollmentService.Enroll': '1.2.0',
  'ServerInfoService.GetServerInfo': '1.2.0',
}

/**
 * Answered only by solo's in-process backend (server/hayat/solo-backend.js):
 * in enterprise the caller refuses before anything is sent, so Hayat never
 * sees them and they set no minimum.
 */
export const SOLO_ONLY = new Set(['DirectoryService.UpdateTenant', 'DirectoryService.SetUserAppearance'])

/** The first Hayat that reports its version: no tabletsgo can need less. */
export const HAYAT_VERSION_FLOOR = '1.2.0'

const parse = (s) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(s || ''))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** The newer of two releases. */
const newer = (a, b) => (compare(parse(a), parse(b)) >= 0 ? a : b)

/** The oldest Hayat this tabletsgo works with. */
export const MIN_HAYAT_VERSION = Object.values(HAYAT_RPCS).reduce(newer, HAYAT_VERSION_FLOOR)

/** have >= need. A version that isn't a release ('dev', a build from source) is new enough. */
export function versionAtLeast(have, need) {
  const h = parse(have)
  const n = parse(need)
  return !h || !n || compare(h, n) >= 0
}

/**
 * What a Hayat's reported version means for this tabletsgo. `running` is ''
 * for a Hayat older than the floor, which can't report one.
 * → { running, needed, ok, problem } — `problem` is the sentence to show when not ok.
 */
export function compatibility(running, apiUrl) {
  const ok = !!running && versionAtLeast(running, MIN_HAYAT_VERSION)
  const what = running || `a release older than ${HAYAT_VERSION_FLOOR} (it doesn't report its version — or ${apiUrl} isn't Hayat's api role)`
  return {
    running: running || null,
    needed: MIN_HAYAT_VERSION,
    ok,
    problem: ok ? null : `This tabletsgo needs Hayat ${MIN_HAYAT_VERSION} or newer, but the Hayat at ${apiUrl} runs ${what}. Upgrade Hayat first.`,
  }
}
