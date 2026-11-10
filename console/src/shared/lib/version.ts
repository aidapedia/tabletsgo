/** Is `version` (e.g. "6.0.16", "16.4") at least `since` (e.g. "6.2.0", "15")? An unknown version passes. */
export function meetsVersion(version: string | null | undefined, since: string) {
  if (!version) return true
  const a = version.split('.').map((p) => parseInt(p, 10) || 0)
  const b = since.split('.').map((p) => parseInt(p, 10) || 0)
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0)
  return true
}
