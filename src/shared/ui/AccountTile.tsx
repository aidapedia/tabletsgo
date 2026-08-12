/**
 * The signed-in person's mark: a glossy rounded tile rather than a flat bubble,
 * because wherever it appears it is standing in for the whole account — name,
 * email and sign-out all hang off it (see `AccountMenu`).
 *
 * The gradient is mixed from `--accent`, so it follows the workspace's colour
 * instead of introducing a second brand. 30px everywhere it appears — the
 * default — with `size` left open for a caller that needs another scale.
 *
 * `size` is given in px at the 16px baseline but emitted as rem, so the tile
 * follows the interface-density setting (which scales the root font-size) the
 * way every rem-based utility around it does.
 *
 * `presence` notches the online dot into the tile's bottom-right corner. It
 * lives here, not in each rail, because the dot is anchored to the *tile* and
 * not to the 40px target around it: hung off the button it would float out into
 * the padding the moment the tile were given another size. Both rails ask for
 * it the same way, so the two read as the same object.
 */

// The dot's ring is punched out of the panel behind it, so the caller has to
// say which surface that is. Tailwind only emits classes it can see written
// out, so these are a lookup rather than an interpolated `border-${surface}`.
const RING: Record<string, string> = {
  bg: 'border-bg',
  panel: 'border-panel',
  elevated: 'border-elevated',
  card: 'border-card',
}

export default function AccountTile({
  label,
  size = 30,
  className = '',
  presence = false,
  surface = 'bg',
}: {
  label?: string
  size?: number
  className?: string
  presence?: boolean
  surface?: 'bg' | 'panel' | 'elevated' | 'card'
}) {
  const tile = (
    <span
      style={{ width: `${size / 16}rem`, height: `${size / 16}rem`, fontSize: `${(size * 0.36) / 16}rem` }}
      className={`flex shrink-0 items-center justify-center rounded-[11px] bg-linear-to-br from-green-bright to-green font-bold text-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] ring-1 ring-inset ring-white/20 ${className}`}
    >
      {label?.[0]?.toUpperCase() || 'A'}
    </span>
  )

  if (!presence) return tile

  // `bg-status-ok`, deliberately not `bg-green`: `--color-green` *is* the
  // workspace accent, so on an amber or blue accent the presence dot stopped
  // reading as "online" and started reading as a warning. Live-state signals
  // stay green whatever the accent is — the same rule the connection dot keeps.
  //
  // The ring is a border rather than a gap so the dot keeps its shape when the
  // row underneath it hovers to a different colour.
  return (
    <span className="relative flex shrink-0">
      {tile}
      <span
        aria-hidden
        style={{ width: `${size * 0.4 / 16}rem`, height: `${size * 0.4 / 16}rem` }}
        className={`absolute -bottom-0.5 -right-0.5 rounded-full border-2 bg-status-ok ${RING[surface] || RING.bg}`}
      />
    </span>
  )
}
