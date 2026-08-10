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
 */
export default function AccountTile({
  label,
  size = 30,
  className = '',
}: {
  label?: string
  size?: number
  className?: string
}) {
  return (
    <span
      style={{ width: `${size / 16}rem`, height: `${size / 16}rem`, fontSize: `${(size * 0.36) / 16}rem` }}
      className={`flex shrink-0 items-center justify-center rounded-[11px] bg-linear-to-br from-green-bright to-green font-bold text-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] ring-1 ring-inset ring-white/20 ${className}`}
    >
      {label?.[0]?.toUpperCase() || 'A'}
    </span>
  )
}
